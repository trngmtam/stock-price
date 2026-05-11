from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class OHLCVRow(BaseModel):
    Date: Optional[str] = Field(None, description="ISO date, optional")
    Open: float
    High: float
    Low: float
    Close: float
    Volume: float


class PredictRequest(BaseModel):
    rows: list[OHLCVRow] = Field(
        ...,
        description="Oldest-first OHLCV rows. Recommend >=60 rows so indicators warm up.",
        min_length=50,
    )
    ticker: Optional[str] = None


class NextDayResponse(BaseModel):
    ticker: Optional[str]
    last_close: float
    predicted_log_return: float
    predicted_price: float
    direction_probability: float
    direction: str  # "up" or "down"


class CumulativeResponse(BaseModel):
    ticker: Optional[str]
    last_close: float
    horizon_days: int
    predicted_cumulative_log_return: float
    predicted_price: float
    direction_probability: float
    direction: str


class MultiStepResponse(BaseModel):
    ticker: Optional[str]
    last_close: float
    horizon_days: int
    predicted_cumulative_log_returns: list[float]
    predicted_prices: list[float]
    direction_probabilities: list[float]


class SignalResponse(BaseModel):
    ticker: Optional[str]
    signal: str  # "buy" / "sell"
    probability: float
    triggered: bool  # probability >= 0.6 (notebook default)


class HealthResponse(BaseModel):
    status: str
    models_loaded: list[str]


# ── Market data (vnstock-backed) ────────────────────────────────────────

class TickerInfo(BaseModel):
    sym: str
    name: str
    sector: str
    exch: str


class HistoryBar(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class HistoryResponse(BaseModel):
    sym: str
    days: int
    bars: list[HistoryBar]


class SnapshotResponse(BaseModel):
    sym: str
    close: float
    changePct: float
    last: Optional[HistoryBar] = None
