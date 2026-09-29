#!/usr/bin/env bash
# Restore an OpenPrivy PostgreSQL logical dump (from db-backup.sh) into a target
# database. Intended for DR drills and cross-account recovery.
#
# WARNING: --clean drops existing objects in the target first. Point TARGET_URL
# at a fresh/disposable database for drills.
#
# Usage:
#   TARGET_URL=postgres://user:pass@host:5432/openprivy_restore \
#   DUMP=/tmp/openprivy-<ts>.dump \
#   scripts/db-restore.sh
set -euo pipefail

: "${TARGET_URL:?set TARGET_URL}"
: "${DUMP:?set DUMP (path to .dump)}"
[[ -f "$DUMP" ]] || { echo "dump not found: $DUMP" >&2; exit 1; }

echo "[restore] restoring ${DUMP} -> ${TARGET_URL%%\?*}"
pg_restore --no-owner --no-privileges --clean --if-exists \
  --dbname="$TARGET_URL" "$DUMP"

echo "[restore] verifying core tables"
for t in users wallets transactions recovery_contacts recovery_guardians; do
  n=$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM \"$t\"")
  echo "  $t: $n rows"
done
echo "[restore] done"
