#!/usr/bin/env bash
# One-shot setup: register the Postgres connection + Airflow Variables the
# DAG needs. Safe to re-run (uses --conn-uri/idempotent set commands).
#
# Run AFTER `docker compose up -d` and after Airflow's web UI is reachable.
#
# Usage:
#   ./bootstrap.sh                       # uses defaults below
#   STOCK_API_URL=http://host.docker.internal:8000 ./bootstrap.sh

set -euo pipefail

COMPOSE_PROJECT="$(basename "$(pwd)")"
AIRFLOW="docker compose exec -T airflow airflow"

# Defaults (override via env vars before invoking the script).
PG_HOST="${PG_HOST:-postgres}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-stocks}"
PG_PASSWORD="${PG_PASSWORD:-stocks}"
PG_DB="${PG_DB:-stocks}"
STOCK_API_URL="${STOCK_API_URL:-http://api:8000}"
MODEL_VERSION="${MODEL_VERSION:-dev}"

echo "▶ Waiting for Airflow standalone to be ready…"
for i in $(seq 1 60); do
  if $AIRFLOW info >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "▶ Registering Postgres connection (postgres_warehouse)…"
$AIRFLOW connections delete postgres_warehouse >/dev/null 2>&1 || true
$AIRFLOW connections add postgres_warehouse \
  --conn-type postgres \
  --conn-host "$PG_HOST" \
  --conn-port "$PG_PORT" \
  --conn-login "$PG_USER" \
  --conn-password "$PG_PASSWORD" \
  --conn-schema "$PG_DB"

echo "▶ Setting Airflow Variables…"
$AIRFLOW variables set stock_api_url "$STOCK_API_URL"
$AIRFLOW variables set model_version "$MODEL_VERSION"

echo "▶ Initialising dbt (deps + first run to create schemas)…"
docker compose exec -T airflow bash -c '
  pip install --quiet dbt-postgres &&
  cd /opt/dbt &&
  dbt debug --profiles-dir /opt/dbt --target prod
'

echo ""
echo "✅ Bootstrap done."
echo "   Airflow UI:    http://localhost:8080  (user: admin, pwd in airflow/standalone_admin_password.txt)"
echo "   FastAPI docs:  http://localhost:8000/docs"
echo "   Postgres:      psql postgresql://$PG_USER:$PG_PASSWORD@localhost:$PG_PORT/$PG_DB"
echo ""
echo "Next: trigger the DAG from the UI, or run:"
echo "   docker compose exec airflow airflow dags trigger stock_prediction_daily"
