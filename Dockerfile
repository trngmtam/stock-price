# Cloud-deployment Dockerfile (build context = repo root).
# Used by Hugging Face Spaces, Render, Railway, Fly.io, Cloud Run.
#
# Bundles backend/app + models/ into a single self-contained image so the
# container has no external dependencies at runtime.
#
# Build:  docker build -t stock-api .
# Run:    docker run -p 7860:7860 stock-api
#
# Hugging Face Spaces auto-detects a Dockerfile at the repo root and uses
# port 7860. Other hosts: set PORT env var.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TF_CPP_MIN_LOG_LEVEL=2

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY backend/app ./app
COPY models       ./models

ENV PORT=7860 \
    MODEL_ROOT=/app/models \
    CORS_ALLOW_ORIGINS=*

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/health || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
