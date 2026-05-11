# Stock Price — Vietnamese Equity Prediction

End-to-end project for forecasting Vietnamese stock prices and generating buy/sell signals with deep learning. Includes the research notebooks, trained models, a FastAPI inference service, a static frontend, and an ELT pipeline scaffold.

## Repository layout

```
.
├── Task-1.ipynb / Task-2.ipynb / Task-3.ipynb / Task-4.ipynb
│       Research notebooks — data prep, return forecasting,
│       buy/sell classifiers, and trading simulation.
├── filter-data.ipynb        Data cleaning / filtering notebook.
├── models/
│   ├── task-2/   model_21.keras, model_22.keras, model_23.keras
│   └── task-3/   vietnam_buy_classifier.keras, vietnam_sell_classifier.keras
├── backend/                 FastAPI inference service (see backend/app).
├── frontend/                Static HTML/JS demo client (predict, signals, portfolio).
├── pipeline/                Local ELT stack (Airbyte source, Airflow, dbt, Postgres, Mongo).
├── Dockerfile               Cloud image — bundles backend + models.
└── backend/Dockerfile       Local dev image — mounts ../models.
```

## Models

| Endpoint                       | Model                                     | Output                                  |
| ------------------------------ | ----------------------------------------- | --------------------------------------- |
| `POST /predict/next-day`       | `models/task-2/model_21.keras`            | next-day log-return + direction         |
| `POST /predict/cumulative-7d`  | `models/task-2/model_22.keras`            | 7-day cumulative log-return + direction |
| `POST /predict/multi-step-7d`  | `models/task-2/model_23.keras`            | per-step 7-day log-returns + directions |
| `POST /predict/buy-signal`     | `models/task-3/vietnam_buy_classifier`    | buy probability + triggered flag        |
| `POST /predict/sell-signal`    | `models/task-3/vietnam_sell_classifier`   | sell probability + triggered flag       |
| `GET  /health`                 | —                                         | available models                        |

Window size: 30 trading days. Send at least 50 rows of OHLCV (≥60 recommended so technical indicators warm up). Trigger threshold for signals: `0.6`.

## Backend — quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# IMPORTANT on macOS: do NOT use --reload (see Troubleshooting).
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Interactive docs: http://localhost:8000/docs

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

Static HTML pages with vanilla JS / JSX in [frontend/pages](frontend/pages):

- [predict.html](frontend/pages/predict.html) — price prediction UI
- [signals.html](frontend/pages/signals.html) — buy/sell signal UI
- [portfolio.html](frontend/pages/portfolio.html) — portfolio view

Serve from any static server, then point it at the backend (the API client lives in [frontend/js/api.js](frontend/js/api.js)):

```bash
cd frontend && python -m http.server 5173
```

A TypeScript client for embedding in other apps is in [backend/frontend-client/stockApi.ts](backend/frontend-client/stockApi.ts).

## Docker

**Cloud (self-contained, models baked in):**

```bash
docker build -t stock-api .
docker run -p 7860:7860 stock-api
```

**Local dev (models mounted from host):**

```bash
cd backend
docker build -t stock-api-dev .
docker run -p 8000:8000 -v $(pwd)/../models:/app/models:ro stock-api-dev
```

## Pipeline (optional)

Local ELT stack in [pipeline/](pipeline) — Postgres + Mongo + Airflow + dbt + an Airbyte source spec for `vnstock`. Spin it up with:

```bash
cd pipeline
docker compose up
```

Airflow UI: http://localhost:8080.

## Troubleshooting

### `[mutex.cc : 452] RAW: Lock blocking 0x...` when starting uvicorn with `--reload`

This is a TensorFlow / abseil interaction with uvicorn's WatchFiles reloader — TF imports run in the parent process, then the reloader forks a worker and the abseil mutex deadlocks across the fork. It is **not** a bug in this project.

Fixes (pick one):

1. **Don't use `--reload`.** The recommended command is:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

2. **Limit what `--reload` watches** so it doesn't restart on every model/venv touch:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
   ```

3. **Pin TF threading before import** if you must keep `--reload`:
   ```bash
   TF_ENABLE_ONEDNN_OPTS=0 OMP_NUM_THREADS=1 uvicorn app.main:app --reload --reload-dir app
   ```

If the message appears once and the server still answers requests on `:8000`, it's harmless log noise — the import finished. If the process actually hangs, apply fix 1 or 2.

### `ModuleNotFoundError: tensorflow` / model load fails

- Confirm the venv is active: `which python` should resolve under `backend/.venv`.
- `pip install -r backend/requirements.txt` — TF 2.15+ is required.
- On Apple Silicon you may prefer `tensorflow-macos` instead of `tensorflow`.

### `Model file not found: .../models/task-2/model_21.keras`

`MODEL_ROOT` points at the wrong directory. From the repo root the default works; otherwise set it explicitly:

```bash
MODEL_ROOT=/absolute/path/to/models uvicorn app.main:app
```

## License

See [Final-project-DL4AI.pdf](Final-project-DL4AI.pdf) for academic context.
