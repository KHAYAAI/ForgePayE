# ForgePay Services Vault Policy
#
# Grants each ForgePay service read access to its own secrets path under
# the "forgepay" KV v2 engine (mounted at forgepay/).
#
# KV v2 stores data at "<mount>/data/<path>", hence the "forgepay/data/..." prefix.

# ── enterprise-treasury ───────────────────────────────────────────────────────
path "forgepay/data/enterprise-treasury" {
  capabilities = ["read"]
}

# ── agent-credit-lines ────────────────────────────────────────────────────────
path "forgepay/data/agent-credit-lines" {
  capabilities = ["read"]
}

# ── agent-identity ────────────────────────────────────────────────────────────
path "forgepay/data/agent-identity" {
  capabilities = ["read"]
}

# ── unified-router ────────────────────────────────────────────────────────────
path "forgepay/data/unified-router" {
  capabilities = ["read"]
}

# ── billing-engine ────────────────────────────────────────────────────────────
path "forgepay/data/billing-engine" {
  capabilities = ["read"]
}

# ── mor-layer ─────────────────────────────────────────────────────────────────
path "forgepay/data/mor-layer" {
  capabilities = ["read"]
}

# ── bank-connectivity ─────────────────────────────────────────────────────────
path "forgepay/data/bank-connectivity" {
  capabilities = ["read"]
}

# ── dashboard ─────────────────────────────────────────────────────────────────
path "forgepay/data/dashboard" {
  capabilities = ["read"]
}

# ── metadata (list only — services can enumerate their own keys) ──────────────
path "forgepay/metadata/enterprise-treasury" {
  capabilities = ["read", "list"]
}
path "forgepay/metadata/agent-credit-lines" {
  capabilities = ["read", "list"]
}
path "forgepay/metadata/agent-identity" {
  capabilities = ["read", "list"]
}
path "forgepay/metadata/unified-router" {
  capabilities = ["read", "list"]
}
path "forgepay/metadata/billing-engine" {
  capabilities = ["read", "list"]
}
path "forgepay/metadata/mor-layer" {
  capabilities = ["read", "list"]
}
path "forgepay/metadata/bank-connectivity" {
  capabilities = ["read", "list"]
}
path "forgepay/metadata/dashboard" {
  capabilities = ["read", "list"]
}

# ── health check (all services) ───────────────────────────────────────────────
path "sys/health" {
  capabilities = ["read"]
}
