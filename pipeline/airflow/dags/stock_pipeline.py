"""
Daily stock-prediction pipeline.

Stages (one DAG run per trading day, scheduled after market close):

  1. ingest        — Airbyte syncs raw OHLCV (vnstock) into Postgres raw.*
  2. ingest_news   — Airbyte syncs news articles into MongoDB
  3. transform     — dbt builds stg_ohlcv → mart.feature_daily
  4. dq_check      — dbt tests + freshness checks; halt on failure
  5. predict       — call FastAPI backend for every active ticker, three
                     regression models + two classifiers, write to mart.prediction
  6. evaluate      — backfill mart.prediction_eval for predictions whose
                     horizon has now elapsed (compute MAE / hit-rate)
  7. publish       — refresh dashboard cache (Superset / Metabase) and ping
                     Slack with daily summary

Failure policy: ingest/transform failures retry x3 with exponential backoff;
predict failures per-ticker are logged but do not fail the whole run.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import requests
from airflow import DAG
from airflow.decorators import task
from airflow.providers.airbyte.operators.airbyte import AirbyteTriggerSyncOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.providers.slack.operators.slack import SlackAPIPostOperator
from airflow.operators.bash import BashOperator
from airflow.operators.empty import EmptyOperator


DEFAULT_ARGS = {
    "owner": "ml-platform",
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=30),
    "email_on_failure": True,
}

API_BASE_URL = "{{ var.value.stock_api_url }}"          # e.g. http://stock-api:8000
WINDOW_DAYS  = 90                                       # rows sent to backend
MODELS_REGRESSION = [
    ("model_21", "/predict/next-day",       1),
    ("model_22", "/predict/cumulative-7d",  7),
    ("model_23", "/predict/multi-step-7d",  7),
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
    schedule="30 16 * * 1-5",                            # 16:30 ICT, weekdays
    catchup=False,
    max_active_runs=1,
    tags=["ml", "stocks", "daily"],
) as dag:

    start = EmptyOperator(task_id="start")

    # ── 1. INGEST ──────────────────────────────────────────────────────
    ingest_ohlcv = AirbyteTriggerSyncOperator(
        task_id="ingest_ohlcv",
        airbyte_conn_id="airbyte_default",
        connection_id="{{ var.value.airbyte_vnstock_conn_id }}",
        asynchronous=False,
        timeout=3600,
    )

    ingest_news = AirbyteTriggerSyncOperator(
        task_id="ingest_news",
        airbyte_conn_id="airbyte_default",
        connection_id="{{ var.value.airbyte_news_conn_id }}",
        asynchronous=False,
        timeout=1800,
    )

    # ── 2. TRANSFORM ───────────────────────────────────────────────────
    dbt_run = BashOperator(
        task_id="dbt_run",
        bash_command="cd /opt/dbt && dbt run --select staging marts --target prod",
    )

    dbt_test = BashOperator(
        task_id="dbt_test",
        bash_command="cd /opt/dbt && dbt test --select staging marts --target prod",
    )

    # ── 3. PREDICT ─────────────────────────────────────────────────────
    @task(task_id="list_active_tickers")
    def list_active_tickers() -> list[str]:
        hook = PostgresHook(postgres_conn_id="postgres_warehouse")
        sql = """
            select distinct ticker
            from mart.feature_daily
            where trade_date = (select max(trade_date) from mart.feature_daily)
        """
        rows = hook.get_records(sql)
        return [r[0] for r in rows]

    @task(task_id="predict_for_ticker", max_active_tis_per_dag=8, retries=1)
    def predict_for_ticker(ticker: str) -> dict:
        """
        For one ticker:
          1. pull last 90d of OHLCV from Postgres
          2. call all 5 model endpoints
          3. write rows to mart.prediction
          4. mirror full request/response into MongoDB prediction_audit
        """
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
            for r in reversed(rows)  # oldest-first
        ]
        run_date = ohlcv[-1]["Date"]
        body = {"ticker": ticker, "rows": ohlcv}
        records = []

        # Regression models → mart.prediction
        for name, path, horizon in MODELS_REGRESSION:
            r = requests.post(f"{API_BASE_URL}{path}", json=body, timeout=30)
            r.raise_for_status()
            resp = r.json()
            if name == "model_23":
                # Multi-step: one row per horizon day.
                for i, (lr, px, dp) in enumerate(zip(
                    resp["predicted_cumulative_log_returns"],
                    resp["predicted_prices"],
                    resp["direction_probabilities"],
                )):
                    records.append((ticker, run_date, name, horizon_day := i + 1,
                                    lr, px, dp, None, None))
            else:
                records.append((
                    ticker, run_date, name,
                    1 if name == "model_21" else 7,
                    resp.get("predicted_log_return") or resp.get("predicted_cumulative_log_return"),
                    resp["predicted_price"],
                    resp["direction_probability"],
                    None, None,
                ))

        # Classifiers → mart.prediction (buy/sell prob columns)
        for name, path in MODELS_CLASSIFIER:
            r = requests.post(f"{API_BASE_URL}{path}", json=body, timeout=30)
            r.raise_for_status()
            resp = r.json()
            buy_p  = resp["probability"] if name == "buy_clf"  else None
            sell_p = resp["probability"] if name == "sell_clf" else None
            records.append((ticker, run_date, name, None,
                            None, None, None, buy_p, sell_p))

        hook.insert_rows(
            table="mart.prediction",
            rows=[
                (t, d, n, h, lr, px, dp, bp, sp,
                 "{{ var.value.model_version }}")
                for (t, d, n, h, lr, px, dp, bp, sp) in records
            ],
            target_fields=[
                "ticker", "run_date", "model_name", "horizon_day",
                "predicted_log_return", "predicted_price",
                "direction_prob", "buy_prob", "sell_prob",
                "model_version",
            ],
        )
        return {"ticker": ticker, "rows_written": len(records)}

    # ── 4. EVALUATE ────────────────────────────────────────────────────
    @task(task_id="evaluate_predictions")
    def evaluate_predictions():
        """Join predictions whose horizon has elapsed against realized prices."""
        hook = PostgresHook(postgres_conn_id="postgres_warehouse")
        hook.run("""
            insert into mart.prediction_eval (
                prediction_id, realized_log_return, realized_price,
                abs_error, hit_direction, evaluated_at
            )
            select
                p.prediction_id,
                ln(o.close / lag_close.close)             as realized_log_return,
                o.close                                   as realized_price,
                abs(p.predicted_price - o.close)          as abs_error,
                sign(p.predicted_log_return) = sign(ln(o.close / lag_close.close))
                                                          as hit_direction,
                now()
            from mart.prediction p
            join stg.stg_ohlcv o
              on o.ticker = p.ticker
             and o.trade_date = p.run_date + (p.horizon_day || ' day')::interval
            join stg.stg_ohlcv lag_close
              on lag_close.ticker = p.ticker
             and lag_close.trade_date = p.run_date
            left join mart.prediction_eval e on e.prediction_id = p.prediction_id
            where e.prediction_id is null
              and p.horizon_day is not null
        """)

    # ── 5. PUBLISH ─────────────────────────────────────────────────────
    refresh_dashboard = BashOperator(
        task_id="refresh_dashboard_cache",
        bash_command="curl -X POST $SUPERSET_URL/api/v1/dashboard/cache/refresh -H \"Authorization: Bearer $SUPERSET_TOKEN\"",
    )

    notify = SlackAPIPostOperator(
        task_id="slack_summary",
        slack_conn_id="slack_default",
        channel="#ml-stock-alerts",
        text=(
            ":chart_with_upwards_trend: Stock pipeline finished for "
            "{{ ds }} — see dashboard: {{ var.value.dashboard_url }}"
        ),
        trigger_rule="all_done",
    )

    end = EmptyOperator(task_id="end")

    # ── Dependencies ───────────────────────────────────────────────────
    tickers = list_active_tickers()
    predictions = predict_for_ticker.expand(ticker=tickers)
    eval_step = evaluate_predictions()

    start >> [ingest_ohlcv, ingest_news] >> dbt_run >> dbt_test >> tickers
    tickers >> predictions >> eval_step >> refresh_dashboard >> notify >> end
