#!/usr/bin/env bash
# Database restore drill: prove a backup of the gateway's Postgres can be restored and is the same data.
#
#   scripts/db-restore-drill.sh SOURCE_DB [SCRATCH_DB]
#
# Takes a pg_dump of SOURCE_DB (custom format), restores it into a brand-new database, and compares per-table
# row counts and a content checksum of the money tables. Exits non-zero on any difference. Uses the standard
# PG* environment variables for the connection. Drops SCRATCH_DB first and again at the end (default name:
# <SOURCE_DB>_restore_drill) — never point it at a database you care about.
#
# In production the same steps apply, with the dump replaced by your real backup (snapshot or PITR restore into
# a scratch instance) and SOURCE_DB being the live database read-only. Do this before launch and after any
# schema change, and record the result.
set -euo pipefail
SRC="${1:?source database}"; DST="${2:-${SRC}_restore_drill}"
DUMP="$(mktemp)"; trap 'rm -f "$DUMP"; psql -qAt -d postgres -c "DROP DATABASE IF EXISTS \"$DST\"" >/dev/null 2>&1 || true' EXIT

echo "== dump $SRC"
pg_dump -Fc -d "$SRC" -f "$DUMP"
echo "== restore into $DST"
psql -qAt -d postgres -c "DROP DATABASE IF EXISTS \"$DST\"" -c "CREATE DATABASE \"$DST\""
pg_restore --no-owner --exit-on-error -d "$DST" "$DUMP"

tables=$(psql -qAt -d "$SRC" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
fail=0
echo "== compare"
for t in $tables; do
  a=$(psql -qAt -d "$SRC" -c "SELECT count(*) FROM \"$t\""); b=$(psql -qAt -d "$DST" -c "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo MISSING)
  if [ "$a" = "$b" ]; then printf 'ok    %-28s %s rows\n' "$t" "$a"; else printf 'FAIL  %-28s source %s restored %s\n' "$t" "$a" "$b"; fail=1; fi
done
for t in payouts deposit_sweeps stablecoin_deposits treasury_transfers; do
  psql -qAt -d "$SRC" -c "SELECT 1 FROM pg_tables WHERE tablename='$t'" | grep -q 1 || continue
  a=$(psql -qAt -d "$SRC" -c "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM \"$t\" t")
  b=$(psql -qAt -d "$DST" -c "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM \"$t\" t")
  if [ "$a" = "$b" ]; then echo "ok    checksum $t"; else echo "FAIL  checksum $t differs"; fail=1; fi
done
[ "$fail" = 0 ] && echo "restore drill passed" || { echo "restore drill FAILED"; exit 1; }
