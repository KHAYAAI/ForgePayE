# Vault Agent Sidecar Configuration — ForgePay Services
#
# Deploy this as a ConfigMap and mount it into the Vault Agent init/sidecar
# container. Each service pod carries a Vault Agent that:
#   1. Logs in via Kubernetes auth using the pod's service-account JWT
#   2. Renews the Vault token automatically
#   3. Renders secrets to /vault/secrets/ as env-file format
#
# In Kubernetes, reference this config via:
#   annotations:
#     vault.hashicorp.com/agent-inject: "true"
#     vault.hashicorp.com/role: "<service-name>"
#
# Or mount the rendered files and source them in your container entrypoint:
#   source /vault/secrets/env

# ── Vault cluster ─────────────────────────────────────────────────────────────
vault {
  address = "http://vault:8200"  # Override via VAULT_ADDR env var in production

  # Retry configuration for transient network failures
  retry {
    num_retries = 5
  }
}

# ── Logging ───────────────────────────────────────────────────────────────────
log_level  = "warn"
log_format = "json"

# ── Kubernetes auth login ─────────────────────────────────────────────────────
auto_auth {
  method "kubernetes" {
    mount_path = "auth/kubernetes"

    config {
      # SERVICE_ACCOUNT_ROLE is set per-pod via the Deployment env/args;
      # defaults to the service name (e.g. "mor-layer").
      role = "REPLACE_WITH_SERVICE_NAME"

      # Path to the projected service-account token (Kubernetes 1.21+)
      token_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
    }
  }

  # Cache the token in-memory and on disk so restarts don't re-auth
  sink "file" {
    config {
      path = "/vault/secrets/.vault-token"
      mode = 0600
    }
  }
}

# ── Token caching (reduces Vault load) ───────────────────────────────────────
cache {
  use_auto_auth_token = true
}

# ── Secret templates ─────────────────────────────────────────────────────────
# Each template block reads a KV v2 secret and renders it as an env file.
# The rendered file is sourced by the container entrypoint or mounted into
# the application runtime directly.
#
# Pattern: one template per service, parameterised by SERVICE_PATH env var.
# In production, generate one config per Deployment rather than one generic config.

# enterprise-treasury
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/enterprise-treasury" -}}
    DATABASE_URL="{{ .Data.data.DATABASE_URL }}"
    VALID_API_KEYS="{{ .Data.data.VALID_API_KEYS }}"
    ALERT_WEBHOOK_URL="{{ .Data.data.ALERT_WEBHOOK_URL }}"
    YIELD_ENGINE_URL="{{ .Data.data.YIELD_ENGINE_URL }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/enterprise-treasury.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}

# agent-credit-lines
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/agent-credit-lines" -}}
    DATABASE_URL="{{ .Data.data.DATABASE_URL }}"
    ENTERPRISE_TREASURY_API_KEY="{{ .Data.data.ENTERPRISE_TREASURY_API_KEY }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/agent-credit-lines.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}

# agent-identity
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/agent-identity" -}}
    DATABASE_URL="{{ .Data.data.DATABASE_URL }}"
    VALID_API_KEYS="{{ .Data.data.VALID_API_KEYS }}"
    KYAPAY_PRIVATE_KEY_PEM="{{ .Data.data.KYAPAY_PRIVATE_KEY_PEM }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/agent-identity.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}

# unified-router
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/unified-router" -}}
    DATABASE_URL="{{ .Data.data.DATABASE_URL }}"
    VALID_API_KEYS="{{ .Data.data.VALID_API_KEYS }}"
    REDIS_URL="{{ .Data.data.REDIS_URL }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/unified-router.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}

# billing-engine
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/billing-engine" -}}
    DATABASE_URL="{{ .Data.data.DATABASE_URL }}"
    KILLBILL_ADMIN_PASSWORD="{{ .Data.data.KILLBILL_ADMIN_PASSWORD }}"
    KILLBILL_WEBHOOK_SECRET="{{ .Data.data.KILLBILL_WEBHOOK_SECRET }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/billing-engine.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}

# mor-layer
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/mor-layer" -}}
    MOR_DATABASE_URL="{{ .Data.data.DATABASE_URL }}"
    MOR_JWT_SECRET="{{ .Data.data.JWT_SECRET }}"
    MOR_HYPERSWITCH_WEBHOOK_SECRET="{{ .Data.data.HYPERSWITCH_WEBHOOK_SECRET }}"
    MOR_AUDITOR_SEED_HEX="{{ .Data.data.AUDITOR_SEED_HEX }}"
    MOR_AVALARA_API_KEY="{{ .Data.data.AVALARA_API_KEY }}"
    MOR_TAXJAR_TOKEN="{{ .Data.data.TAXJAR_TOKEN }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/mor-layer.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}

# bank-connectivity
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/bank-connectivity" -}}
    JWT_SECRET="{{ .Data.data.JWT_SECRET }}"
    PLAID_CLIENT_ID="{{ .Data.data.PLAID_CLIENT_ID }}"
    PLAID_SECRET="{{ .Data.data.PLAID_SECRET }}"
    ENCRYPTION_KEY="{{ .Data.data.ENCRYPTION_KEY }}"
    INTERNAL_SECRET="{{ .Data.data.INTERNAL_SECRET }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/bank-connectivity.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}

# dashboard
template {
  contents = <<-EOT
    {{- with secret "forgepay/data/dashboard" -}}
    NEXTAUTH_SECRET="{{ .Data.data.NEXTAUTH_SECRET }}"
    HYPERSWITCH_MERCHANT_API_KEY="{{ .Data.data.HYPERSWITCH_MERCHANT_API_KEY }}"
    KILLBILL_API_SECRET="{{ .Data.data.KILLBILL_API_SECRET }}"
    {{- end }}
  EOT
  destination = "/vault/secrets/dashboard.env"
  perms       = "0600"
  command     = "/bin/sh -c 'kill -HUP 1 2>/dev/null || true'"
}
