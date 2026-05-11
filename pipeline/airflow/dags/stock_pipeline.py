"""
Daily stock-prediction pipeline.

Stages (one DAG run per trading day, scheduled after market close):

  1. ingest        — vnstock pulls daily OHLCV into Postgres raw.ohlcv_landing
  2. transform     — dbt builds stg_ohlcv → mart.feature_daily
  3. dq_check      — dbt tests (schema + freshness); halt on failure
  4. predict       — call FastAPI backend for every active ticker; three
                     regression models + two classifiers; rows → mart.prediction
  5. evaluate      — for predictions whose horizon has elapsed, join realized
                     prices → mart.prediction_eval (MAE, hit-rate)
  6. publish       — emit a Slack summary (optional; gated by Airflow conn)

Failure policy: ingest/transform retry x3 with exponential backoff; per-ticker
predict failures are isolated (one bad ticker doesn't fail the run).
"""
from __future__ import annotations

from datetime import datetime, timedelta

import requests
from airflow import DAG
from airflow.decorators import task
from airflow.exceptions import AirflowSkipException
from airflow.models import Variable
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.operators.bash import BashOperator
from airflow.operators.empty import EmptyOperator


DEFAULT_ARGS = {
    "owner": "ml-platform",
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=30),
    "email_on_failure": False,
}

# Airflow Variables (set via `airflow variables set` or UI):
#   stock_api_url   — base URL of the FastAPI backend (e.g. http://api:8000)
#   model_version   — git sha or tag stamped onto each prediction
WINDOW_DAYS = 90

# Universe — same as backend/app/market_data.py
TICKERS = [
    "VNM", "VIC", "VHM", "FPT", "HPG", "MSN", "VCB",
    "TCB", "BID", "MWG", "GAS", "PLX", "ACB", "SAB", "HDB",
]

MODELS_REGRESSION = [
    ("model_21", "/predict/next-day",      1),
    ("model_22", "/predict/cumulative-7d", 7),
    ("model_23", "/predict/multi-step-7d", 7),
]
MODELS_CLASSIFIER = [
    ("buy_clf",  "/predict/buy-signal"),
    ("sell_clf", "/predict/sell-signal"),
]


with DAG(
    dag_id="stock_prediction_daily",
    description="Daily ingest → transform → predict → evaluate pipeline.",
    default_args=DEFAULT_ARGS,
    start_date=datetime(2026, 1, 1),
    schedule="30 16 * * 1-5",       # 16:30 ICT, Mon–Fri (after market close)
    catchup=False,
    max_active_runs=1,
    tags=["ml", "stocks", "daily"],
) as dag:

    start = EmptyOperator(task_id="start")

    # ── 1. INGEST: vnstock → Postgres raw.ohlcv_landing ────────────────
    @task(task_id="ingest_ohlcv")
    def ingest_ohlcv():
        """Fetch last 5 trading days of OHLCV per ticker and upsert."""
        from vnstock import Vnstock
        end = datetime.now()
        start = end - timedelta(days=10)  # 10 cal days → ~5 trading days
        v = Vnstock()
        rows = []
        for sym in TICKERS:
            try:
                df = v.stock(symbol=sym, source="VCI").quote.history(
                    start=start.strftime("%Y-%m-%d"),
                    end=end.strftime("%Y-%m-%d"),
                    interval="1D",
                )
            except Exception as e:
                print(f"[warn] vnstock {sym}: {e}")
                continue
            if df is None or df.empty:
                continue
            for _, r in df.iterrows():
                rows.append((
                    sym,
                    str(r["time"])[:10],
                    float(r["open"]), float(r["high"]), float(r["low"]),
                    float(r["close"]), int(r["volume"]) if r["volume"] else 0,
                    "vnstock",
                ))

        if not rows:
            raise RuntimeError("No rows fetched from vnstock")

        # Manual upsert: hook.insert_rows can't do ON CONFLICT.
        hook = PostgresHook(postgres_conn_id="postgres_warehouse")
        conn = hook.get_conn()
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO raw.ohlcv_landing
                    (ticker, trade_date, open, high, low, close, volume, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (ticker, trade_date, source) DO UPDATE SET
                    open = EXCLUDED.open, high = EXCLUDED.high,
                    low  = EXCLUDED.low,  close = EXCLUDED.close,
                    volume = EXCLUDED.volume,
                    ingested_at = now()
                """,
                rows,
            )
        conn.commit()
        return {"rows_upserted": len(rows), "tickers": len(TICKERS)}

    # ── 2-3. TRANSFORM + TEST (dbt) ────────────────────────────────────
    dbt_run = BashOperator(
        task_id="dbt_run",
        bash_command=(
            "cd /opt/dbt && "
            "dbt run --profiles-dir /opt/dbt --select staging marts --target prod"
        ),
    )
    dbt_test = BashOperator(
        task_id="dbt_test",
        bash_command=(
            "cd /opt/dbt && "
            "dbt test --profiles-dir /opt/dbt --select staging marts --target prod"
        ),
    )

    # ── 4. PREDICT — fan out per ticker ────────────────────────────────
    @task(task_id="list_active_tickers")
    def list_active_tickers() -> list[str]:
        hook = PostgresHook(postgres_conn_id="postgres_warehouse")
        rows = hook.get_records("""
            select distinct ticker
            from mart.feature_daily
            where trade_date = (select max(trade_date) from mart.feature_daily)
        """)
        return [r[0] for r in rows] or TICKERS  # fall back to full universe on first run

    @task(task_id="predict_for_ticker", max_active_tis_per_dag=4, retries=1)
    def predict_for_ticker(ticker: str) -> dict:
        api_url = Variable.get("stock_api_url", default_var="http://api:8000")
        model_version = Variable.get("model_version", default_var="dev")

        hook = PostgresHook(postgres_conn_id="postgres_warehouse")
        rows = hook.get_records(
            """
            select trade_date, open, high, low, close, volume
            from stg.stg_ohlcv
            where ticker = %s
            order by trade_date desc
            limit %s
            """,
            parameters=[ticker, WINDOW_DAYS],
        )
        if len(rows) < 60:
            return {"ticker": ticker, "skipped": True, "reason": "insufficient history"}

        ohlcv = [
            {"Date": str(r[0]), "Open": float(r[1]), "High": float(r[2]),
             "Low": float(r[3]), "Close": float(r[4]), "Volume": float(r[5])}
            for r in reversed(rows)
        ]
        run_date = ohlcv[-1]["Date"]
        body = {"ticker": ticker, "rows": ohlcv}
        records = []  # (model_name, horizon, log_ret, price, dir_prob, buy_p, sell_p)

        # Regressors
        for name, path, _ in MODELS_REGRESSION:
            r = requests.post(f"{api_url}{path}", json=body, timeout=30)
            r.raise_for_status()
            resp = r.json()
            if name == "model_23":
                for i, (lr, px, dp) in enumerate(zip(
                    resp["predicted_cumulative_log_returns"],
                    resp["predicted_prices"],
                    resp["direction_probabilities"],
                )):
                    records.append((name, i + 1, lr, px, dp, None, None))
            else:
                records.append((
                    name,
                    1 if name == "model_21" else 7,
                    resp.get("predicted_log_return") or resp.get("predicted_cumulative_log_return"),
                    resp["predicted_price"],
                    resp["direction_probability"],
                    None, None,
                ))

        # Classifiers
        for name, path in MODELS_CLASSIFIER:
            r = requests.post(f"{api_url}{path}", json=body, timeout=30)
            r.raise_for_status()
            resp = r.json()
            buy_p  = resp["probability"] if name == "buy_clf"  else None
            sell_p = resp["probability"] if name == "sell_clf" else None
            records.append((name, None, None, None, None, buy_p, sell_p))

        # Upsert into mart.prediction
        conn = hook.get_conn()
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO mart.prediction
                  (ticker, run_date, model_name, model_version, horizon_day,
                   predicted_log_return, predicted_price, direction_prob,
                   buy_prob, sell_prob)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (ticker, run_date, model_name, model_version, horizon_day)
                DO UPDATE SET
                  predicted_log_return = EXCLUDED.predicted_log_return,
                  predicted_price      = EXCLUDED.predicted_price,
                  direction_prob       = EXCLUDED.direction_prob,
                  buy_prob             = EXCLUDED.buy_prob,
                  sell_prob            = EXCLUDED.sell_prob,
                  created_at           = now()
                """,
                [
                    (ticker, run_date, name, model_version, horizon,
                     lr, px, dp, bp, sp)
                    for (name, horizon, lr, px, dp, bp, sp) in records
                ],
            )
        conn.commit()
        return {"ticker": ticker, "rows_written": len(records)}

    # ── 5. EVALUATE: backfill realized vs predicted ────────────────────
    @task(task_id="evaluate_predictions")
    def evaluate_predictions():
        hook = PostgresHook(postgres_conn_id="postgres_warehouse")
        hook.run("""
            INSERT INTO mart.prediction_eval (
                prediction_id, realized_log_return, realized_price,
                abs_error, hit_direction, evaluated_at
            )
            SELECT
                p.prediction_id,
                ln(o.close / lc.close)                   AS realized_log_return,
                o.close                                  AS realized_price,
                abs(p.predicted_price - o.close)         AS abs_error,
                sign(p.predicted_log_return) = sign(ln(o.close / lc.close))
                                                         AS hit_direction,
                now()
            FROM mart.prediction p
            JOIN stg.stg_ohlcv o
              ON o.ticker = p.ticker
             AND o.trade_date = p.run_date + (p.horizon_day || ' day')::interval
            JOIN stg.stg_ohlcv lc
              ON lc.ticker = p.ticker
             AND lc.trade_date = p.run_date
            LEFT JOIN mart.prediction_eval e
              ON e.prediction_id = p.prediction_id
            WHERE e.prediction_id IS NULL
              AND p.horizon_day IS NOT NULL
        """)

    # ── 6. PUBLISH (optional) ──────────────────────────────────────────
    @task(task_id="slack_summary", trigger_rule="all_done")
    def slack_summary():
        """Skipped if no Slack webhook is configured."""
        webhook = Variable.get("slack_webhook_url", default_var="")
        if not webhook:
            raise AirflowSkipException("slack_webhook_url not set; skipping.")
        try:
            requests.post(webhook, json={
                "text": f":chart_with_upwards_trend: Stock pipeline finished — {datetime.utcnow().isoformat()}Z"
            }, timeout=10).raise_for_status()
        except Exception as e:
            print(f"[warn] slack post failed: {e}")

    end = EmptyOperator(task_id="end")

    # ── Dependencies ───────────────────────────────────────────────────
    ingest = ingest_ohlcv()
    tickers = list_active_tickers()
    predictions = predict_for_ticker.expand(ticker=tickers)
    eval_step = evaluate_predictions()
    summary = slack_summary()

    start >> ingest >> dbt_run >> dbt_test >> tickers
    tickers >> predictions >> eval_step >> summary >> end
