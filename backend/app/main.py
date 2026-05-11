"""
FastAPI service exposing Task 2 (price prediction) and Task 3 (buy/sell signal)
models as REST endpoints.

Run:
    cd backend
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Interactive docs: http://localhost:8000/docs
"""
from __future__ import annotations

import os
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .features import build_window
from . import inference
from . import market_data
from .schemas import (
    PredictRequest,
    NextDayResponse,
    CumulativeResponse,
    MultiStepResponse,
    SignalResponse,
    HealthResponse,
    TickerInfo,
    HistoryResponse,
    SnapshotResponse,
)

WINDOW_SIZE = 30
HORIZON_K = 7
SIGNAL_TRIGGER_THRESHOLD = 0.6  # matches the notebook's trading sim default

app = FastAPI(
    title="Stock Prediction API",
    description=(
        "REST API serving Vietnamese stock prediction models from Task 2 "
        "(next-day return, 7-day cumulative return, 7-day per-step return) "
        "and Task 3 (buy / sell signal classifiers)."
    ),
    version="1.0.0",
)

# CORS — allow the Claude Design frontend (and any local dev client) to call us.
_allow_origins = os.environ.get(
    "CORS_ALLOW_ORIGINS",
    "*",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allow_origins],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", response_model=HealthResponse)
@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", models_loaded=inference.list_available())


def _prep(req: PredictRequest, feature_set: str):
    rows = [r.model_dump() for r in req.rows]
    try:
        X, last_close = build_window(rows, WINDOW_SIZE, feature_set)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return X, last_close


# ── Task 2 endpoints ────────────────────────────────────────────────────────

@app.post("/predict/next-day", response_model=NextDayResponse)
def predict_next_day(req: PredictRequest):
    X, last_close = _prep(req, "t2")
    ret_head, dir_head = inference.model_21().predict(X, verbose=0)
    log_ret = float(ret_head.flatten()[0])
    dir_prob = float(dir_head.flatten()[0])
    return NextDayResponse(
        ticker=req.ticker,
        last_close=last_close,
        predicted_log_return=log_ret,
        predicted_price=last_close * float(np.exp(log_ret)),
        direction_probability=dir_prob,
        direction="up" if dir_prob >= 0.5 else "down",
    )


@app.post("/predict/cumulative-7d", response_model=CumulativeResponse)
def predict_cumulative_7d(req: PredictRequest):
    X, last_close = _prep(req, "t2")
    ret_head, dir_head = inference.model_22().predict(X, verbose=0)
    log_ret = float(ret_head.flatten()[0])
    dir_prob = float(dir_head.flatten()[0])
    return CumulativeResponse(
        ticker=req.ticker,
        last_close=last_close,
        horizon_days=HORIZON_K,
        predicted_cumulative_log_return=log_ret,
        predicted_price=last_close * float(np.exp(log_ret)),
        direction_probability=dir_prob,
        direction="up" if dir_prob >= 0.5 else "down",
    )


@app.post("/predict/multi-step-7d", response_model=MultiStepResponse)
def predict_multi_step_7d(req: PredictRequest):
    X, last_close = _prep(req, "t2")
    ret_head, dir_head = inference.model_23().predict(X, verbose=0)
    log_rets = ret_head.flatten().astype(float).tolist()
    dir_probs = dir_head.flatten().astype(float).tolist()
    prices = [last_close * float(np.exp(r)) for r in log_rets]
    return MultiStepResponse(
        ticker=req.ticker,
        last_close=last_close,
        horizon_days=HORIZON_K,
        predicted_cumulative_log_returns=log_rets,
        predicted_prices=prices,
        direction_probabilities=dir_probs,
    )


# ── Task 3 endpoints ────────────────────────────────────────────────────────

@app.post("/predict/buy-signal", response_model=SignalResponse)
def predict_buy_signal(req: PredictRequest):
    X, _ = _prep(req, "t3")
    proba = float(inference.model_buy().predict(X, verbose=0).flatten()[0])
    return SignalResponse(
        ticker=req.ticker,
        signal="buy",
        probability=proba,
        triggered=proba >= SIGNAL_TRIGGER_THRESHOLD,
    )


@app.post("/predict/sell-signal", response_model=SignalResponse)
def predict_sell_signal(req: PredictRequest):
    X, _ = _prep(req, "t3")
    proba = float(inference.model_sell().predict(X, verbose=0).flatten()[0])
    return SignalResponse(
        ticker=req.ticker,
        signal="sell",
        probability=proba,
        triggered=proba >= SIGNAL_TRIGGER_THRESHOLD,
    )


# ── Real-time market data (vnstock) ─────────────────────────────────────────

@app.get("/data/tickers", response_model=list[TickerInfo])
def data_tickers():
    """Curated VN-Index universe with name / sector / exchange."""
    return market_data.list_tickers()


@app.get("/data/history/{sym}", response_model=HistoryResponse)
def data_history(sym: str, days: int = 240):
    """Daily OHLCV bars from vnstock, oldest-first. Server-side cached 15 min."""
    sym = sym.upper()
    days = max(10, min(1000, days))
    try:
        bars = market_data.get_history(sym, days=days)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return HistoryResponse(sym=sym, days=len(bars), bars=bars)


@app.get("/data/snapshot/{sym}", response_model=SnapshotResponse)
def data_snapshot(sym: str):
    """Latest close + day change %. Server-side cached 60 sec."""
    sym = sym.upper()
    try:
        snap = market_data.get_snapshot(sym)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return SnapshotResponse(**snap)
