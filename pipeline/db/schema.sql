-- Postgres schema for the stock-prediction pipeline.
--
-- Layers:
--   raw_*   : exact byte copies from upstream sources (immutable, append-only).
--   stg_*   : cleaned & standardized (built by dbt staging models).
--   mart_*  : analytics-ready facts (built by dbt marts: features, predictions).
--
-- MongoDB stores the unstructured side: news, filings, free-text reports —
-- joined back to Postgres on (ticker, ts).

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS stg;
CREATE SCHEMA IF NOT EXISTS mart;

-- ── RAW LAYER ───────────────────────────────────────────────────────────

-- Landed by Airbyte from the price-data source (e.g. vnstock, vendor CSV drop).
CREATE TABLE IF NOT EXISTS raw.ohlcv_landing (
  ticker        TEXT        NOT NULL,
  trade_date    DATE        NOT NULL,
  open          NUMERIC,
  high          NUMERIC,
  low           NUMERIC,
  close         NUMERIC,
  volume        BIGINT,
  source        TEXT        NOT NULL,    -- 'vnstock' | 'vendor_x' | ...
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, trade_date, source)
);
CREATE INDEX IF NOT EXISTS idx_raw_ohlcv_ingested ON raw.ohlcv_landing (ingested_at DESC);

CREATE TABLE IF NOT EXISTS raw.ticker_overview (
  ticker         TEXT PRIMARY KEY,
  company_name   TEXT,
  sector         TEXT,
  exchange       TEXT,
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── STAGING LAYER (dbt-built) ───────────────────────────────────────────

-- Deduped, type-cast, weekend rows dropped, ticker normalized.
-- Materialized as a view by dbt; DDL here is for reference only.

-- ── MART LAYER ──────────────────────────────────────────────────────────

-- Daily features used by Task-2 / Task-3 models (computed once per ticker-day).
CREATE TABLE IF NOT EXISTS mart.feature_daily (
  ticker        TEXT NOT NULL,
  trade_date    DATE NOT NULL,
  log_ret       DOUBLE PRECISION,
  hl_range      DOUBLE PRECISION,
  oc_range      DOUBLE PRECISION,
  sma5_ratio    DOUBLE PRECISION,
  sma20_ratio   DOUBLE PRECISION,
  macd_norm     DOUBLE PRECISION,
  macd_signal   DOUBLE PRECISION,
  rsi14         DOUBLE PRECISION,
  bb_pos        DOUBLE PRECISION,
  vol_20        DOUBLE PRECISION,
  log_volume    DOUBLE PRECISION,
  mom_5         DOUBLE PRECISION,
  mom_20        DOUBLE PRECISION,
  PRIMARY KEY (ticker, trade_date)
);

-- One row per (ticker, run_date, model). Predictions are append-only so we can
-- replay accuracy over time and track model drift.
CREATE TABLE IF NOT EXISTS mart.prediction (
  prediction_id   BIGSERIAL PRIMARY KEY,
  ticker          TEXT        NOT NULL,
  run_date        DATE        NOT NULL,         -- last observed trade day
  model_name      TEXT        NOT NULL,         -- 'model_21' | 'model_22' | 'model_23' | 'buy_clf' | 'sell_clf'
  model_version   TEXT        NOT NULL,         -- git sha or tag
  horizon_day     INT,                          -- 1..7 for regressors; NULL for classifiers
  predicted_log_return DOUBLE PRECISION,
  predicted_price      DOUBLE PRECISION,
  direction_prob       DOUBLE PRECISION,
  buy_prob             DOUBLE PRECISION,
  sell_prob            DOUBLE PRECISION,
  inference_latency_ms INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, run_date, model_name, model_version, horizon_day)
);
CREATE INDEX IF NOT EXISTS idx_pred_ticker_date ON mart.prediction (ticker, run_date DESC);

-- Realized vs predicted (joined back once t+horizon ground truth lands).
-- Built by a dbt incremental model; lets the dashboard show rolling MAE/IC.
CREATE TABLE IF NOT EXISTS mart.prediction_eval (
  prediction_id   BIGINT PRIMARY KEY REFERENCES mart.prediction(prediction_id),
  realized_log_return DOUBLE PRECISION,
  realized_price      DOUBLE PRECISION,
  abs_error           DOUBLE PRECISION,
  hit_direction       BOOLEAN,
  evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
