# Stock Price Prediction — DL4AI Final Project

End-to-end project for forecasting **Nasdaq** and **Vietnamese** equity prices and producing **buy/sell** trading signals with deep-learning models. The repository contains:

1. Research notebooks for Tasks 1–4 (data prep, return forecasting, signal classifiers, profitable-ticker selection).
2. Trained `.keras` model artifacts used in production.
3. A **FastAPI** inference service that exposes every model as a REST endpoint and also proxies live OHLCV from `vnstock`.
4. A **static React/Vanilla-JS frontend** (Vercel-hosted) that consumes the API and visualizes predictions/signals on real-time Vietnamese stock data.
5. A **local ELT pipeline** (Postgres + MongoDB + Airflow + dbt) that automates daily ingest → transform → predict → evaluate.

## Repository layout

```
.
├── 220177-project-notebooks/
│   ├── Task-1.ipynb      Nasdaq next-day Open price (window=30, multi-feature LSTM)
│   ├── Task-2.ipynb      Vietnam stocks: next-day, 7-day cumulative, 7-day multi-step
│   ├── Task-3.ipynb      Buy / Sell signal classifiers (binary, dual model)
│   ├── Task-4.ipynb      Profitable ticker selection / portfolio sketch
│   └── filter-data.ipynb Raw data cleaning, dedup, weekend removal, schema unification
├── models/
│   ├── task-2/   model_21.keras, model_22.keras, model_23.keras
│   └── task-3/   vietnam_buy_classifier.keras, vietnam_sell_classifier.keras
├── backend/                 FastAPI service (app/main.py, features.py, inference.py, market_data.py)
├── frontend/                Static HTML/JSX pages: predict.html, signals.html
├── pipeline/                Airflow DAG + dbt project + Postgres/Mongo schema + docker-compose
├── Dockerfile               Cloud image — bundles backend + models (Hugging Face Spaces)
└── backend/Dockerfile       Local dev image — mounts ../models read-only
```

## Models

| Endpoint                       | Artifact                                       | Output                                  |
| ------------------------------ | ---------------------------------------------- | --------------------------------------- |
| `POST /predict/next-day`       | `models/task-2/model_21.keras`                 | next-day log-return + direction         |
| `POST /predict/cumulative-7d`  | `models/task-2/model_22.keras`                 | 7-day cumulative log-return + direction |
| `POST /predict/multi-step-7d`  | `models/task-2/model_23.keras`                 | per-step 7-day log-returns + directions |
| `POST /predict/buy-signal`     | `models/task-3/vietnam_buy_classifier.keras`   | buy probability + triggered flag        |
| `POST /predict/sell-signal`    | `models/task-3/vietnam_sell_classifier.keras`  | sell probability + triggered flag       |
| `GET  /health`                 | —                                              | service status, loaded models           |
| `GET  /data/tickers`           | curated VN-Index universe                      | name / sector / exchange                |
| `GET  /data/history/{sym}`     | `vnstock` (cached 15 min)                      | daily OHLCV bars                        |
| `GET  /data/snapshot/{sym}`    | `vnstock` (cached 60 s)                        | latest close + day change %             |

Window size: **30 trading days**. Send at least **50 rows** of OHLCV (≥60 recommended so SMA/MACD/RSI warm up). Trigger threshold for buy/sell signals: **0.6** (matches the trading-simulation default in Task-3.ipynb).

## Backend — quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# IMPORTANT on macOS: do NOT use --reload (see Troubleshooting).
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Interactive docs: <http://localhost:8000/docs>

Example request:

```bash
curl -X POST http://localhost:8000/predict/next-day \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"VNM","rows":[{"Open":..., "High":..., "Low":..., "Close":..., "Volume":...}, ... 60+ rows ...]}'
```

### Environment variables

| Variable             | Default               | Purpose                                  |
| -------------------- | --------------------- | ---------------------------------------- |
| `MODEL_ROOT`         | `<repo>/models`       | Where to load `.keras` files from        |
| `CORS_ALLOW_ORIGINS` | `*`                   | Comma-separated list of allowed origins  |
| `PORT`               | `8000` (`7860` cloud) | HTTP port                                |

## Frontend

Static pages live in [frontend/pages](frontend/pages):

- [predict.html](frontend/pages/predict.html) — price-prediction UI (Tasks 2.1 / 2.2 / 2.3)
- [signals.html](frontend/pages/signals.html) — buy/sell signal UI (Task 3)
- [portfolio.html](frontend/pages/portfolio.html) — portfolio view (Task 4)


The frontend **does not accept user-supplied OHLCV**. By design it pulls real-time bars for a chosen ticker via the backend's `vnstock`-backed `/data/history/{sym}` endpoint, then forwards them to the prediction endpoints. Justification is given in the project report.

Serve locally and the page will auto-detect `localhost`:

```bash
cd frontend && python -m http.server 5173
# Open http://localhost:5173/pages/predict.html
```

The production deployment lives on Vercel and points at the Hugging Face Spaces backend (`https://trngmtam-stock-price.hf.space`).

## Docker

**Cloud image (self-contained — models baked in):**

```bash
docker build -t stock-api .
docker run -p 7860:7860 stock-api
```

**Local dev image (models mounted from host):**

```bash
cd backend
docker build -t stock-api-dev .
docker run -p 8000:8000 -v $(pwd)/../models:/app/models:ro stock-api-dev
```

## Pipeline

Local stack in [pipeline/](pipeline/) — Postgres + MongoDB + the FastAPI image + Airflow standalone running a daily DAG that calls dbt:

```bash
cd pipeline
docker compose up
```

- Airflow UI: <http://localhost:8080>
- Postgres warehouse: `localhost:5432` (user/db: `stocks`)
- API (in-stack): <http://localhost:8000>

DAG `stock_prediction_daily` runs Mon–Fri at 16:30 ICT. Stages:

```
start → ingest_ohlcv → dbt_run → dbt_test
      → list_active_tickers → predict_for_ticker[]
      → evaluate_predictions → slack_summary → end
```

See the project report (Section 5.3) for a full walkthrough and the known issue (`mart.prediction` is currently empty — fix tracked for a future iteration).

## Troubleshooting

### `[mutex.cc : 452] RAW: Lock blocking 0x...` when starting uvicorn with `--reload`

TensorFlow / abseil interaction with uvicorn's WatchFiles reloader — TF imports run in the parent process, then the reloader forks a worker and the abseil mutex deadlocks across the fork. Not a bug in this project.

Fixes (pick one):

1. **Don't use `--reload`.** Recommended:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
2. **Limit what `--reload` watches:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
   ```
3. **Pin TF threading before import:**
   ```bash
   TF_ENABLE_ONEDNN_OPTS=0 OMP_NUM_THREADS=1 uvicorn app.main:app --reload --reload-dir app
   ```

### `ModuleNotFoundError: tensorflow` / model load fails

- Confirm the venv is active: `which python` should resolve under `backend/.venv`.
- `pip install -r backend/requirements.txt` — TF 2.15+ is required.
- On Apple Silicon, `tensorflow-macos` is a working alternative.

### `Model file not found: .../models/task-2/model_21.keras`

`MODEL_ROOT` points at the wrong directory. From the repo root the default works; otherwise set it explicitly:

```bash
MODEL_ROOT=/absolute/path/to/models uvicorn app.main:app
```

## License

Academic project. See `Final-project-DL4AI.pdf` for assignment context.
