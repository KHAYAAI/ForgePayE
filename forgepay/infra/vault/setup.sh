#!/usr/bin/env bash
# ForgePay Vault Secrets Setup
#
# Enables the KV v2 engine, writes the forgepay-services policy, configures
# Kubernetes auth, creates per-service roles, and seeds all service secrets
# with CHANGEME placeholder values that must be replaced before production use.
#
# Prerequisites:
#   - vault CLI installed and on PATH
#   - VAULT_ADDR and VAULT_TOKEN environment variables exported
#   - If running inside Kubernetes: KUBERNETES_HOST env var must be set
#
# Usage:
#   export VAULT_ADDR=https://vault.forgepay.internal
#   export VAULT_TOKEN=<root-or-admin-token>
#   export KUBERNETES_HOST=https://<k8s-api-server>:6443
#   bash setup.sh

set -euo pipefail

# ── helpers ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ── prerequisite checks ───────────────────────────────────────────────────────
command -v vault >/dev/null 2>&1 || die "vault CLI not found — install from https://developer.hashicorp.com/vault/install"
[[ -n "${VAULT_ADDR:-}" ]]  || die "VAULT_ADDR is not set"
[[ -n "${VAULT_TOKEN:-}" ]] || die "VAULT_TOKEN is not set"

log "Vault server : $VAULT_ADDR"
vault status -format=json | grep -q '"initialized":true' || die "Vault is not initialized"

# ── 1. Enable KV v2 at forgepay/ ─────────────────────────────────────────────
log "Step 1 — enabling KV v2 secret engine at path 'forgepay'"
vault secrets enable -path=forgepay kv-v2 2>/dev/null \
  && log "KV v2 enabled at forgepay/" \
  || warn "KV v2 already enabled at forgepay/ — skipping"

# ── 2. Write the forgepay-services policy ─────────────────────────────────────
log "Step 2 — writing policy 'forgepay-services'"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vault policy write forgepay-services "${SCRIPT_DIR}/policy.hcl"
log "Policy written"

# ── 3. Enable Kubernetes auth ─────────────────────────────────────────────────
log "Step 3 — enabling Kubernetes auth method"
vault auth enable kubernetes 2>/dev/null \
  && log "Kubernetes auth enabled" \
  || warn "Kubernetes auth already enabled — skipping"

K8S_HOST="${KUBERNETES_HOST:-https://kubernetes.default.svc}"
log "Configuring Kubernetes auth (host: $K8S_HOST)"

if [[ -f /var/run/secrets/kubernetes.io/serviceaccount/token ]]; then
  vault write auth/kubernetes/config \
    token_reviewer_jwt="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
    kubernetes_host="$K8S_HOST" \
    kubernetes_ca_cert="$(cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt)"
  log "Kubernetes auth configured from in-cluster service account"
else
  warn "Not running in-cluster — skipping token_reviewer_jwt config."
  warn "Run the following manually once you have a reviewer token:"
  warn "  vault write auth/kubernetes/config token_reviewer_jwt=<token> kubernetes_host=$K8S_HOST kubernetes_ca_cert=<ca.crt>"
fi

# ── 4. Create per-service Kubernetes auth roles ───────────────────────────────
log "Step 4 — creating Kubernetes auth roles for each service"

K8S_NAMESPACE="${K8S_NAMESPACE:-forgepay}"

create_role() {
  local service="$1"
  vault write "auth/kubernetes/role/${service}" \
    bound_service_account_names="${service}" \
    bound_service_account_namespaces="${K8S_NAMESPACE}" \
    policies="forgepay-services" \
    ttl="1h" \
    max_ttl="4h"
  log "  role/${service} -> sa/${service} in ns/${K8S_NAMESPACE}"
}

create_role enterprise-treasury
create_role agent-credit-lines
create_role agent-identity
create_role unified-router
create_role billing-engine
create_role mor-layer
create_role bank-connectivity
create_role dashboard

# ── 5. Seed secrets with CHANGEME placeholders ────────────────────────────────
log "Step 5 — seeding secrets (CHANGEME placeholders — replace before production)"

# Helper: only write if the secret does not already exist
kv_put() {
  local path="$1"; shift
  if vault kv get -format=json "forgepay/${path}" >/dev/null 2>&1; then
    warn "  forgepay/${path} already exists — skipping (run 'vault kv put' to update)"
  else
    vault kv put "forgepay/${path}" "$@"
    log "  wrote forgepay/${path}"
  fi
}

# forgepay/enterprise-treasury
kv_put enterprise-treasury \
  DATABASE_URL="postgresql://forgepay:CHANGEME@postgres:5432/enterprise_treasury" \
  VALID_API_KEYS="CHANGEME_API_KEY_1,CHANGEME_API_KEY_2" \
  ALERT_WEBHOOK_URL="https://hooks.slack.com/services/CHANGEME" \
  YIELD_ENGINE_URL="http://yield-engine:3010"

# forgepay/agent-credit-lines
kv_put agent-credit-lines \
  DATABASE_URL="postgresql://forgepay:CHANGEME@postgres:5432/agent_credit_lines" \
  ENTERPRISE_TREASURY_API_KEY="CHANGEME_TREASURY_API_KEY"

# forgepay/agent-identity
kv_put agent-identity \
  DATABASE_URL="postgresql://forgepay:CHANGEME@postgres:5432/agent_identity" \
  VALID_API_KEYS="CHANGEME_API_KEY_1,CHANGEME_API_KEY_2" \
  KYAPAY_PRIVATE_KEY_PEM="-----BEGIN EC PRIVATE KEY-----\nCHANGEME\n-----END EC PRIVATE KEY-----"

# forgepay/unified-router
kv_put unified-router \
  DATABASE_URL="postgresql://forgepay:CHANGEME@postgres:5432/unified_router" \
  VALID_API_KEYS="CHANGEME_API_KEY_1,CHANGEME_API_KEY_2" \
  REDIS_URL="redis://:CHANGEME@redis:6379/0"

# forgepay/billing-engine
kv_put billing-engine \
  DATABASE_URL="jdbc:postgresql://postgres:5432/killbill?user=forgepay&password=CHANGEME" \
  KILLBILL_ADMIN_PASSWORD="CHANGEME_KILLBILL_ADMIN_PASSWORD" \
  KILLBILL_WEBHOOK_SECRET="CHANGEME_KILLBILL_WEBHOOK_SECRET"

# forgepay/mor-layer
kv_put mor-layer \
  DATABASE_URL="postgresql://forgepay:CHANGEME@postgres:5432/mor_layer" \
  JWT_SECRET="CHANGEME_JWT_SECRET_32_CHARS_MINIMUM" \
  HYPERSWITCH_WEBHOOK_SECRET="CHANGEME_HYPERSWITCH_WEBHOOK_SECRET" \
  AUDITOR_SEED_HEX="CHANGEME_64_CHAR_HEX_SEED" \
  AVALARA_API_KEY="CHANGEME_AVALARA_API_KEY" \
  TAXJAR_TOKEN="CHANGEME_TAXJAR_TOKEN"

# forgepay/bank-connectivity
kv_put bank-connectivity \
  JWT_SECRET="CHANGEME_JWT_SECRET_32_CHARS_MINIMUM" \
  PLAID_CLIENT_ID="CHANGEME_PLAID_CLIENT_ID" \
  PLAID_SECRET="CHANGEME_PLAID_SECRET" \
  ENCRYPTION_KEY="CHANGEME_AES256_KEY_64_HEX_CHARS" \
  INTERNAL_SECRET="CHANGEME_INTERNAL_SHARED_SECRET"

# forgepay/dashboard
kv_put dashboard \
  NEXTAUTH_SECRET="CHANGEME_NEXTAUTH_SECRET_32_CHARS_MINIMUM" \
  HYPERSWITCH_MERCHANT_API_KEY="CHANGEME_HYPERSWITCH_MERCHANT_API_KEY" \
  KILLBILL_API_SECRET="CHANGEME_KILLBILL_API_SECRET"

# ── done ──────────────────────────────────────────────────────────────────────
log ""
log "Vault setup complete."
log ""
log "Next steps:"
log "  1. Replace every CHANGEME value: vault kv patch forgepay/<service> KEY=real_value"
log "  2. Verify: vault kv list forgepay/ && vault kv get forgepay/<service>"
log "  3. Deploy ExternalSecrets Operator and apply k8s-external-secrets.yaml"
log "  4. Restart service pods to pick up injected secrets"
