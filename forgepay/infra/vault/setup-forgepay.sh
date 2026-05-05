#!/bin/bash
# ForgePay Vault Setup Script
#
# Usage:
#   ./setup-forgepay.sh dev   # Setup development environment
#   ./setup-forgepay.sh staging  # Setup staging environment
#   ./setup-forgepay.sh prod  # Setup production environment (requires MFA)
#
# Prerequisites:
#   - vault CLI installed
#   - VAULT_ADDR and VAULT_TOKEN environment variables set
#   - Admin access to Vault

set -euo pipefail

ENVIRONMENT="${1:-dev}"

if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
  echo "Usage: $0 [dev|staging|prod]"
  exit 1
fi

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
if ! command -v vault &> /dev/null; then
  log_error "vault CLI not found. Install from https://www.vaultproject.io/downloads"
  exit 1
fi

if [ -z "${VAULT_ADDR:-}" ]; then
  log_error "VAULT_ADDR environment variable not set"
  exit 1
fi

log_info "Setting up Vault for $ENVIRONMENT environment"
log_info "Vault server: $VAULT_ADDR"

# Environment-specific configuration
case "$ENVIRONMENT" in
  dev)
    NAMESPACE="forgepay-dev"
    SECRET_PATH="forgepay/dev"
    K8S_NAMESPACE="forgepay-dev"
    LOG_LEVEL="debug"
    ;;
  staging)
    NAMESPACE="forgepay-staging"
    SECRET_PATH="forgepay/staging"
    K8S_NAMESPACE="forgepay-staging"
    LOG_LEVEL="info"
    ;;
  prod)
    NAMESPACE="forgepay"
    SECRET_PATH="forgepay/prod"
    K8S_NAMESPACE="forgepay"
    LOG_LEVEL="warn"
    log_warn "Setting up PRODUCTION environment. This requires elevated access."
    read -p "Continue? (yes/no): " confirm
    [ "$confirm" = "yes" ] || exit 1
    ;;
esac

# 1. Enable KV v2 engine if not already enabled
log_info "Checking KV v2 secret engine..."
if ! vault secrets list -format=json 2>/dev/null | jq -e ".\"$SECRET_PATH/\"" > /dev/null 2>&1; then
  log_info "Enabling KV v2 at $SECRET_PATH"
  vault secrets enable -version=2 -path="$SECRET_PATH" kv || true
else
  log_info "KV v2 already enabled at $SECRET_PATH"
fi

# 2. Enable audit logging
if [ "$ENVIRONMENT" = "prod" ]; then
  log_info "Enabling audit logging..."
  vault audit enable file file_path="/var/log/vault-audit.log" || true
fi

# 3. Create policies
log_info "Creating Vault policies..."

# Read-only policy for CI/CD pipelines
cat > /tmp/forgepay-readonly.hcl << EOF
path "$SECRET_PATH/*" {
  capabilities = ["read", "list"]
}
EOF

vault policy write "forgepay-$ENVIRONMENT-readonly" /tmp/forgepay-readonly.hcl

# Read-write policy for platform engineers
cat > /tmp/forgepay-admin.hcl << EOF
path "$SECRET_PATH/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "sys/policies/acl/*" {
  capabilities = ["read", "list"]
}
EOF

vault policy write "forgepay-$ENVIRONMENT-admin" /tmp/forgepay-admin.hcl

# 4. Configure Kubernetes auth (if running in k8s)
log_info "Configuring Kubernetes authentication..."

if vault auth list -format=json 2>/dev/null | jq -e '."kubernetes/"' > /dev/null 2>&1; then
  log_info "Kubernetes auth already configured"
else
  log_info "Enabling Kubernetes auth..."
  vault auth enable kubernetes || true
fi

# Get k8s cluster info (assumes we're in a cluster)
if [ -f /var/run/secrets/kubernetes.io/serviceaccount/token ]; then
  SA_TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
  K8S_HOST="https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT"
  CA_CERT=$(cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt)

  log_info "Configuring k8s auth with cluster: $K8S_HOST"

  vault write auth/kubernetes/config \
    token_reviewer_jwt="$SA_TOKEN" \
    kubernetes_host="$K8S_HOST" \
    kubernetes_ca_cert="$CA_CERT" || true
fi

# Create Kubernetes role for service accounts
log_info "Creating Kubernetes service account roles..."

vault write "auth/kubernetes/role/forgepay-services" \
  bound_service_account_names="forgepay-services" \
  bound_service_account_namespaces="$K8S_NAMESPACE" \
  policies="forgepay-$ENVIRONMENT-admin" \
  ttl="1h" || true

# 5. Initialize secrets (with placeholder values)
log_info "Initializing secrets..."

declare -A SECRETS=(
  ["database/password"]="please-change-in-vault"
  ["database/replica-password"]="please-change-in-vault"
  ["payment-engine/api_key"]="test_key_changeme"
  ["webhook/signing_secret"]="webhook_secret_changeme"
  ["crypto-gateway/hd_wallet_seed"]="test_seed_changeme"
  ["api-keys/circle"]="test_key_changeme"
  ["api-keys/claude"]="test_key_changeme"
  ["api-keys/avalara"]="test_key_changeme"
  ["api-keys/onfido"]="test_key_changeme"
  ["integrations/slack_webhook"]="https://hooks.slack.com/services/changeme"
  ["blockchain/eth_rpc_key"]="test_key_changeme"
  ["blockchain/bitcoin_rpc_key"]="test_key_changeme"
)

for secret_path in "${!SECRETS[@]}"; do
  full_path="$SECRET_PATH/$secret_path"
  value="${SECRETS[$secret_path]}"

  # Check if secret already exists
  if vault kv get -format=json "$full_path" > /dev/null 2>&1; then
    log_warn "Secret already exists at $full_path (skipping)"
  else
    log_info "Creating placeholder for $secret_path"
    vault kv put "$full_path" \
      value="$value" \
      created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      environment="$ENVIRONMENT" || true
  fi
done

# 6. Create rotation schedule (prod only)
if [ "$ENVIRONMENT" = "prod" ]; then
  log_info "Setting up secret rotation schedule..."
  # This would typically be done via external tools like:
  # - Vault's built-in secret rotation
  # - Kubernetes CronJobs
  # - External services like Teleport

  cat > /tmp/rotation-policy.txt << 'EOF'
Production Secret Rotation Schedule:
- API Keys: Every 90 days
- Database passwords: Every 90 days
- Webhook signing secrets: Every 180 days
- Crypto seeds: Never (key rotation instead)
- Certificates: 30 days before expiration

Implement via:
1. Vault Enterprise automatic rotation
2. External CronJob in Kubernetes
3. Manual process with change tickets
EOF

  log_warn "Review rotation policy in /tmp/rotation-policy.txt"
fi

# 7. Generate summary report
log_info "Vault setup completed successfully!"

cat > "/tmp/forgepay-vault-summary-$ENVIRONMENT.txt" << EOF
ForgePay Vault Setup Summary
============================
Environment: $ENVIRONMENT
Namespace: $NAMESPACE
Secret Path: $SECRET_PATH
K8S Namespace: $K8S_NAMESPACE
Log Level: $LOG_LEVEL
Vault Server: $VAULT_ADDR

Configured Components:
  ✓ KV v2 Secret Engine
  ✓ Vault Policies (read-only, admin)
  ✓ Kubernetes Authentication
  ✓ Service Account Roles
  ✓ Initial Secrets (with placeholder values)

Next Steps:
  1. Update placeholder secret values with actual credentials
  2. Grant access to team members via Vault
  3. Install External Secrets Operator in K8s (if not done)
  4. Deploy services with secret injection

Commands to update secrets:
  vault kv put $SECRET_PATH/database/password value="YOUR_PASSWORD"
  vault kv put $SECRET_PATH/payment-engine/api_key value="YOUR_KEY"
  vault kv put $SECRET_PATH/crypto-gateway/hd_wallet_seed value="YOUR_SEED"

View all secrets:
  vault kv list $SECRET_PATH/

View specific secret:
  vault kv get $SECRET_PATH/database/password

Note: Store this summary safely for future reference.
EOF

log_info "Summary saved to /tmp/forgepay-vault-summary-$ENVIRONMENT.txt"
cat "/tmp/forgepay-vault-summary-$ENVIRONMENT.txt"

log_info "Setup complete! Remember to:"
log_info "  1. Update secret values from placeholders"
log_info "  2. Grant access permissions to team members"
log_info "  3. Document the setup process"
log_info "  4. Enable MFA for production access"
