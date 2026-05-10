"""Lazy model loading. Models are loaded once on first use and cached."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import tensorflow as tf

# Repo root: backend/app/inference.py -> ../../
REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = Path(os.environ.get("MODEL_ROOT", REPO_ROOT / "models"))


def _load(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Model file not found: {path}")
    return tf.keras.models.load_model(path, compile=False)


@lru_cache(maxsize=1)
def model_21():
    return _load(MODEL_ROOT / "task-2" / "model_21.keras")


@lru_cache(maxsize=1)
def model_22():
    return _load(MODEL_ROOT / "task-2" / "model_22.keras")


@lru_cache(maxsize=1)
def model_23():
    return _load(MODEL_ROOT / "task-2" / "model_23.keras")


@lru_cache(maxsize=1)
def model_buy():
    return _load(MODEL_ROOT / "task-3" / "vietnam_buy_classifier.keras")


@lru_cache(maxsize=1)
def model_sell():
    return _load(MODEL_ROOT / "task-3" / "vietnam_sell_classifier.keras")


def list_available() -> list[str]:
    out = []
    for name, p in [
        ("model_21", MODEL_ROOT / "task-2" / "model_21.keras"),
        ("model_22", MODEL_ROOT / "task-2" / "model_22.keras"),
        ("model_23", MODEL_ROOT / "task-2" / "model_23.keras"),
        ("buy_classifier", MODEL_ROOT / "task-3" / "vietnam_buy_classifier.keras"),
        ("sell_classifier", MODEL_ROOT / "task-3" / "vietnam_sell_classifier.keras"),
    ]:
        if p.exists():
            out.append(name)
    return out
