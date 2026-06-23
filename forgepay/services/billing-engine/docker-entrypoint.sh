#!/bin/bash
set -e

echo "[billing-engine] Waiting for PostgreSQL at ${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}..."

RETRIES=0
MAX_RETRIES=30

until nc -z "${POSTGRES_HOST:-postgres}" "${POSTGRES_PORT:-5432}"; do
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    echo "[billing-engine] ERROR: PostgreSQL not reachable after ${MAX_RETRIES} attempts (60s). Aborting."
    exit 1
  fi
  sleep 2
done

echo "[billing-engine] PostgreSQL ready."

exec java ${KILLBILL_JVM_OPTS} -jar /var/lib/killbill/killbill.jar
