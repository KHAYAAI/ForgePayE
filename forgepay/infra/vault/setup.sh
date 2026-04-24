#!/bin/bash
# Vault Setup Script for ForgePay
# Initializes Vault, enables auth methods, and loads policies

set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-https://vault.example.com}"
VAULT_TOKEN="${VAULT_TOKEN:-}"
ENVIRONMENT="${ENVIRONMENT:-staging}"

echo "🔐 Initializing Vault for ForgePay ($ENVIRONMENT)..."

# 1. Enable KV v2 Secret Engine
echo "Enabling KV v2 secret engine..."
vault secrets enable -version=2 -path=secret kv || echo "KV secret engine already enabled"

# 2. Enable Kubernetes Auth Method
echo "Enabling Kubernetes auth method..."
vault auth enable kubernetes || echo "Kubernetes auth method already enabled"

# 3. Configure Kubernetes Auth
echo "Configuring Kubernetes auth..."
vault write auth/kubernetes/config \
  token_reviewer_jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token \
  kubernetes_host=$KUBERNETES_HOST \
  kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt

# 4. Create Vault Policies
echo "Creating Vault policies..."
vault policy write forgepay-auditor - << EOF
path "secret/data/forgepay/auditor/*" {
  capabilities = ["read"]
}
path "secret/data/forgepay/integrations/*" {
  capabilities = ["read"]
}
path "sys/health" {
  capabilities = ["read"]
}
EOF

vault policy write forgepay-checkout - << EOF
path "secret/data/forgepay/database/*" {
  capabilities = ["read"]
}
path "secret/data/forgepay/integrations/*" {
  capabilities = ["read"]
}
path "secret/data/forgepay/webhooks/*" {
  capabilities = ["read"]
}
path "sys/health" {
  capabilities = ["read"]
}
EOF

# 5. Create Kubernetes Auth Roles
echo "Creating Kubernetes auth roles..."

# Auditor service
vault write auth/kubernetes/role/forgepay-auditor \
  bound_service_account_names=forgepay-auditor \
  bound_service_account_namespaces=default \
  policies=forgepay-auditor \
  ttl=1h

# MoR Layer (checkout)
vault write auth/kubernetes/role/forgepay-checkout \
  bound_service_account_names=forgepay-checkout \
  bound_service_account_namespaces=default \
  policies=forgepay-checkout \
  ttl=1h

# 6. Initialize Auditor Keys
echo "Initializing auditor keypair..."
AUDITOR_SEED=$(openssl rand -hex 32)
AUDITOR_PUBLIC_KEY=$(echo "Derived from seed (implement X25519 derivation here)")

vault kv put secret/forgepay/auditor/keys/current \
  seed="$AUDITOR_SEED" \
  public_key="$AUDITOR_PUBLIC_KEY" \
  created_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  rotation_count=0

# 7. Initialize Integration Secrets
echo "Initializing integration secrets..."

vault kv put secret/forgepay/integrations/stripe \
  api_key="${STRIPE_API_KEY:-}" \
  webhook_secret="${STRIPE_WEBHOOK_SECRET:-}"

vault kv put secret/forgepay/integrations/hyperswitch \
  api_key="${HYPERSWITCH_API_KEY:-}" \
  webhook_secret="${HYPERSWITCH_WEBHOOK_SECRET:-}"

vault kv put secret/forgepay/integrations/polygon-rpc \
  endpoint="${POLYGON_RPC_ENDPOINT:-https://polygon-rpc.com}"

vault kv put secret/forgepay/integrations/ethereum-rpc \
  endpoint="${ETHEREUM_RPC_ENDPOINT:-https://eth-mainnet.alchemyapi.io/v2/}"

vault kv put secret/forgepay/integrations/base-rpc \
  endpoint="${BASE_RPC_ENDPOINT:-https://mainnet.base.org}"

vault kv put secret/forgepay/integrations/arbitrum-rpc \
  endpoint="${ARBITRUM_RPC_ENDPOINT:-https://arb1.arbitrum.io/rpc}"

# 8. Initialize Database Secrets
echo "Initializing database secrets..."

vault kv put secret/forgepay/database/postgres \
  host="${DB_HOST:-}" \
  port="${DB_PORT:-5432}" \
  username="${DB_USERNAME:-}" \
  password="${DB_PASSWORD:-}" \
  database="forgepay"

vault kv put secret/forgepay/database/redis \
  host="${REDIS_HOST:-}" \
  port="${REDIS_PORT:-6379}" \
  password="${REDIS_PASSWORD:-}"

echo "✅ Vault setup complete!"
echo ""
echo "Next steps:"
echo "1. Verify secrets: vault kv list secret/forgepay/"
echo "2. Test auth: vault write -method=post auth/kubernetes/login role=forgepay-auditor jwt=..."
echo "3. Deploy to Kubernetes with RBAC bound to these roles"
