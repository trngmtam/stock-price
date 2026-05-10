# Local-development Dockerfile (build context = backend/).
# Models are NOT baked in — mount the host's ../models at /app/models.
#
# Build:  docker build -t stock-api .
# Run:    docker run -p 8000:8000 -v $(pwd)/../models:/app/models:ro stock-api
#
# For cloud deployment use the root Dockerfile (../Dockerfile), which bundles
# both the app and the models into a self-contained image.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TF_CPP_MIN_LOG_LEVEL=2

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

ENV PORT=8000 \
    MODEL_ROOT=/app/models \
    CORS_ALLOW_ORIGINS=*

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/health || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
