#!/usr/bin/env bash
# Logical backup of the OpenPrivy PostgreSQL database.
#
# RDS already does automated snapshots (30-day retention in the CFN template);
# this is a portable, restorable *logical* dump for cross-account/offline copies
# and pre-migration safety nets. Uses the custom format (compressed, parallel
# restore, selective).
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/openprivy \
#   BACKUP_S3_URI=s3://openprivy-prod-backups-<acct>/pg \
#   scripts/db-backup.sh
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR:-/tmp}/openprivy-${TS}.dump"

echo "[backup] dumping to ${OUT}"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$OUT"
echo "[backup] size: $(du -h "$OUT" | cut -f1)"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  echo "[backup] uploading to ${BACKUP_S3_URI}/openprivy-${TS}.dump"
  aws s3 cp "$OUT" "${BACKUP_S3_URI}/openprivy-${TS}.dump" --sse AES256
  echo "[backup] uploaded"
fi

echo "[backup] done: ${OUT}"
