"""
Real-time Vietnamese market data via the vnstock Python library.

Why a server-side wrapper:
  • Frontend is static (Vercel) — it can't call vnstock directly.
  • vnstock proxies upstream sources (VCI/TCBS) with informal rate limits;
    we cache aggressively so the frontend can poll freely.
  • Failures fall back to a clear HTTP error so the frontend can surface them.

Caching:
  • Ticker list:   24-hour TTL  (rarely changes)
  • History:       15-min TTL   (intraday rebuild OK)
  • Snapshot:      60-sec TTL   (latest price for hero card)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
from cachetools import TTLCache, cached
from cachetools.keys import hashkey

log = logging.getLogger(__name__)

# Curated VN-Index large-cap universe with metadata that vnstock doesn't expose
# uniformly across data sources. Adding tickers here is the supported way to
# extend coverage.
TICKER_UNIVERSE: list[dict] = [
    {"sym": "VNM", "name": "Vinamilk",                "sector": "Consumer",    "exch": "HOSE"},
    {"sym": "VIC", "name": "Vingroup JSC",            "sector": "Real Estate", "exch": "HOSE"},
    {"sym": "VHM", "name": "Vinhomes",                "sector": "Real Estate", "exch": "HOSE"},
    {"sym": "FPT", "name": "FPT Corporation",         "sector": "Technology",  "exch": "HOSE"},
    {"sym": "HPG", "name": "Hoa Phat Group",          "sector": "Materials",   "exch": "HOSE"},
    {"sym": "MSN", "name": "Masan Group",             "sector": "Consumer",    "exch": "HOSE"},
    {"sym": "VCB", "name": "Vietcombank",             "sector": "Banking",     "exch": "HOSE"},
    {"sym": "TCB", "name": "Techcombank",             "sector": "Banking",     "exch": "HOSE"},
    {"sym": "BID", "name": "BIDV",                    "sector": "Banking",     "exch": "HOSE"},
    {"sym": "MWG", "name": "Mobile World Investment", "sector": "Retail",      "exch": "HOSE"},
    {"sym": "GAS", "name": "PetroVietnam Gas",        "sector": "Energy",      "exch": "HOSE"},
    {"sym": "PLX", "name": "Petrolimex",              "sector": "Energy",      "exch": "HOSE"},
    {"sym": "ACB", "name": "Asia Commercial Bank",    "sector": "Banking",     "exch": "HOSE"},
    {"sym": "SAB", "name": "Sabeco",                  "sector": "Consumer",    "exch": "HOSE"},
    {"sym": "HDB", "name": "HD Bank",                 "sector": "Banking",     "exch": "HOSE"},
]

VALID_SYMS = {t["sym"] for t in TICKER_UNIVERSE}

_history_cache = TTLCache(maxsize=128, ttl=15 * 60)   # 15 min
_snapshot_cache = TTLCache(maxsize=128, ttl=60)        # 1 min


def list_tickers() -> list[dict]:
    """Return curated universe (no upstream call needed)."""
    return TICKER_UNIVERSE


def _vnstock_history(sym: str, start: str, end: str) -> pd.DataFrame:
    """Call vnstock (lazy import so module load is fast)."""
    from vnstock import Vnstock
    stock = Vnstock().stock(symbol=sym, source="VCI")
    df = stock.quote.history(start=start, end=end, interval="1D")
    # vnstock v3 returns columns: time, open, high, low, close, volume
    return df


@cached(_history_cache, key=lambda sym, days=240: hashkey(sym, days))
def get_history(sym: str, days: int = 240) -> list[dict]:
    """
    Daily OHLCV ending today (or last trading day), oldest-first.
    Cached for 15 minutes per (sym, days).
    """
    if sym not in VALID_SYMS:
        raise ValueError(f"Unknown ticker: {sym}. Known: {sorted(VALID_SYMS)}")

    # Fetch a bit extra so weekend/holiday gaps don't shrink the window.
    end = datetime.today()
    start = end - timedelta(days=int(days * 1.6) + 30)
    try:
        df = _vnstock_history(sym, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    except Exception as e:
        log.exception("vnstock history failed for %s", sym)
        raise RuntimeError(f"Upstream data fetch failed for {sym}: {e}") from e

    if df is None or df.empty:
        raise RuntimeError(f"No history returned for {sym}")

    df = df.copy()
    # Normalise time column
    if "time" in df.columns:
        df["date"] = pd.to_datetime(df["time"]).dt.strftime("%Y-%m-%d")
    else:
        df["date"] = pd.to_datetime(df.index).strftime("%Y-%m-%d")
    df = df.sort_values("date").tail(days)

    out = [
        {
            "date":   row["date"],
            "open":   float(row["open"]),
            "high":   float(row["high"]),
            "low":    float(row["low"]),
            "close":  float(row["close"]),
            "volume": int(row["volume"]) if pd.notna(row["volume"]) else 0,
        }
        for _, row in df.iterrows()
    ]
    return out


@cached(_snapshot_cache, key=lambda sym: hashkey(sym))
def get_snapshot(sym: str) -> dict:
    """Latest close + day change %. Pulls from the cached history."""
    hist = get_history(sym, days=10)
    if len(hist) < 2:
        return {"sym": sym, "close": hist[-1]["close"] if hist else 0.0, "changePct": 0.0, "last": hist[-1] if hist else None}
    last, prev = hist[-1], hist[-2]
    chg = (last["close"] - prev["close"]) / prev["close"] * 100.0
    return {"sym": sym, "close": last["close"], "changePct": round(chg, 3), "last": last}


def clear_caches() -> None:
    _history_cache.clear()
    _snapshot_cache.clear()
