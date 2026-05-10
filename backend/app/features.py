"""Feature engineering — mirrors Task-2.ipynb and Task-3.ipynb."""
from __future__ import annotations

import numpy as np
import pandas as pd


# Task 2 features (pattern features, scale-invariant).
FEATURES_T2 = [
    "LogRet", "HL_range", "OC_range",
    "SMA5_ratio", "SMA20_ratio",
    "MACD_norm", "MACD_signal",
    "RSI14", "BB_pos", "Vol_20",
    "LogVolume", "Mom_5", "Mom_20",
]

# Task 3 features (raw OHLCV + technical indicators).
FEATURES_T3 = [
    "Open", "High", "Low", "Close", "Volume",
    "LogRet", "SMA5", "SMA20", "MACD", "MACD_sig",
    "RSI14", "Vol20", "LogVolume", "BBpos", "Mom10",
]


def compute_features_t2(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    p = out["Close"]

    out["LogRet"] = np.log(p / p.shift(1))
    out["HL_range"] = (out["High"] - out["Low"]) / out["Close"]
    out["OC_range"] = (out["Close"] - out["Open"]) / out["Open"]

    out["SMA5_ratio"] = p / p.rolling(5).mean() - 1
    out["SMA20_ratio"] = p / p.rolling(20).mean() - 1

    ema12 = p.ewm(span=12, adjust=False).mean()
    ema26 = p.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    macd_sig = macd.ewm(span=9, adjust=False).mean()
    out["MACD_norm"] = macd / p
    out["MACD_signal"] = (macd - macd_sig) / p

    delta = p.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    out["RSI14"] = (100 - 100 / (1 + rs)) / 100

    bb_mid = p.rolling(20).mean()
    bb_std = p.rolling(20).std()
    out["BB_pos"] = (p - (bb_mid - 2 * bb_std)) / ((bb_mid + 2 * bb_std) - (bb_mid - 2 * bb_std) + 1e-9)

    out["Vol_20"] = out["LogRet"].rolling(20).std()
    out["LogVolume"] = np.log1p(out["Volume"])
    out["Mom_5"] = p / p.shift(5) - 1
    out["Mom_20"] = p / p.shift(20) - 1

    return out


def compute_features_t3(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    p = out["Close"]

    out["LogRet"] = np.log(p / p.shift(1))
    out["SMA5"] = p.rolling(5).mean()
    out["SMA20"] = p.rolling(20).mean()
    ema12 = p.ewm(span=12, adjust=False).mean()
    ema26 = p.ewm(span=26, adjust=False).mean()
    out["MACD"] = ema12 - ema26
    out["MACD_sig"] = out["MACD"].ewm(span=9, adjust=False).mean()

    delta = p.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    out["RSI14"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))

    out["Vol20"] = out["LogRet"].rolling(20).std()
    out["LogVolume"] = np.log1p(out["Volume"])

    bb_mid = p.rolling(20).mean()
    bb_std = p.rolling(20).std()
    out["BBpos"] = (p - (bb_mid - 2 * bb_std)) / ((bb_mid + 2 * bb_std) - (bb_mid - 2 * bb_std))

    out["Mom10"] = p / p.shift(10) - 1
    return out


def per_window_zscore(window: np.ndarray) -> np.ndarray:
    """Z-score each feature column within a single window (T, F)."""
    w = window.astype(np.float32).copy()
    mu = w.mean(axis=0, keepdims=True)
    sd = w.std(axis=0, keepdims=True)
    sd = np.where(sd > 1e-8, sd, 1.0)
    return (w - mu) / sd


def build_window(
    rows: list[dict],
    window_size: int,
    feature_set: str,
) -> tuple[np.ndarray, float]:
    """
    Build a single (1, window_size, n_features) input from raw OHLCV rows.

    `rows` must be sorted oldest-first and contain at least ~50 entries so
    the indicators have time to warm up. Returns (X, last_close).
    """
    df = pd.DataFrame(rows)
    required = {"Open", "High", "Low", "Close", "Volume"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required OHLCV columns: {missing}")

    if feature_set == "t2":
        df = compute_features_t2(df)
        cols = FEATURES_T2
    elif feature_set == "t3":
        df = compute_features_t3(df)
        cols = FEATURES_T3
    else:
        raise ValueError(f"Unknown feature set: {feature_set}")

    df = df.dropna(subset=cols).reset_index(drop=True)
    if len(df) < window_size:
        raise ValueError(
            f"Need at least {window_size} rows after warm-up; got {len(df)}. "
            f"Send ~{window_size + 30} raw OHLCV rows."
        )

    window = df[cols].tail(window_size).values.astype(np.float32)
    last_close = float(df["Close"].iloc[-1])
    X = per_window_zscore(window)[None, ...]
    return X, last_close
