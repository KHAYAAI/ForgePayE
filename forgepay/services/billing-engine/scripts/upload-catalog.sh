#!/usr/bin/env bash
# Upload FORGE's catalog to one Kill Bill tenant.
#
# In multi-tenant mode (org.killbill.server.multitenant=true) Kill Bill does
# not fall back to org.killbill.catalog.uri for a tenant: until a catalog is
# uploaded, every subscription call fails with "No existing versions in the
# VersionedCatalog". Run once per tenant, and again after a catalog change
# (Kill Bill keeps every uploaded version).
#
# Usage: KILLBILL_URL=http://billing-engine:8080 KILLBILL_USERNAME=admin \
#        KILLBILL_PASSWORD=... KILLBILL_API_KEY=... KILLBILL_API_SECRET=... \
#        scripts/upload-catalog.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
catalog="$here/config/catalog/forgepay-base-catalog.xml"
: "${KILLBILL_URL:?}" "${KILLBILL_PASSWORD:?}" "${KILLBILL_API_KEY:?}" "${KILLBILL_API_SECRET:?}"
auth=(-u "${KILLBILL_USERNAME:-admin}:${KILLBILL_PASSWORD}"
      -H "X-Killbill-ApiKey: ${KILLBILL_API_KEY}" -H "X-Killbill-ApiSecret: ${KILLBILL_API_SECRET}"
      -H "X-Killbill-CreatedBy: upload-catalog")

errors=$(curl -sfS "${auth[@]}" -H 'Content-Type: text/xml' --data-binary @"$catalog" \
  "$KILLBILL_URL/1.0/kb/catalog/xml/validate")
if [ "$errors" != '{"catalogValidationErrors":[]}' ]; then
  echo "Catalog failed validation: $errors" >&2
  exit 1
fi

code=$(curl -sS -o /dev/null -w '%{http_code}' "${auth[@]}" -H 'Content-Type: text/xml' \
  --data-binary @"$catalog" "$KILLBILL_URL/1.0/kb/catalog/xml")
[ "$code" = 201 ] || { echo "Upload failed: HTTP $code" >&2; exit 1; }
echo "Catalog uploaded for tenant ${KILLBILL_API_KEY}"
