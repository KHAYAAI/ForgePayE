# ForgePay Secrets Management Guide

## Overview

ForgePay uses **HashiCorp Vault** for all secret management in production and staging environments. This guide explains how to manage API keys, database credentials, and other sensitive data.

## Secret Categories

### 1. Database Credentials
- PostgreSQL primary/replica passwords
- RDS master user credentials
- Location: `forgepay/database/*`

### 2. API Keys
- Hyperswitch / Payment Engine API key
- Claude API key
- Circle API key
- Avalara (tax engine) credentials
- Onfido (KYC/AML) credentials
- Location: `forgepay/api-keys/*`

### 3. Cryptographic Secrets
- Webhook signing secret (HMAC-SHA256 key)
- Crypto gateway HD wallet seed
- Certificate private keys
- Location: `forgepay/crypto/*`

### 4. Blockchain Configuration
- RPC endpoints with API keys
- Smart contract private keys (for automated deployments)
- Location: `forgepay/blockchain/*`

### 5. Third-Party Service Credentials
- Slack webhook URLs
- PagerDuty API keys
- GitHub tokens (if using GitOps)
- Location: `forgepay/integrations/*`

## Vault Setup

### Prerequisites
- Vault CLI installed: https://www.vaultproject.io/downloads
- Access to vault server URL
- Authentication token with admin rights

### Initial Setup (DevOps Only)

```bash
# 1. Configure Vault CLI
export VAULT_ADDR=https://vault.example.com
export VAULT_TOKEN=your_initial_token

# 2. Enable KV v2 secret engine for ForgePay
vault secrets enable -version=2 -path=forgepay kv

# 3. Create audit log policy
cat > /tmp/audit-policy.hcl << 'EOF'
# Audit all secret reads and writes
path "forgepay/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
EOF

vault write sys/policies/acl/forgepay-admin @/tmp/audit-policy.hcl

# 4. Create Kubernetes auth role for ForgePay services
vault auth enable kubernetes
vault write auth/kubernetes/config \
  token_reviewer_jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token \
  kubernetes_host=https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT \
  kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt

vault write auth/kubernetes/role/forgepay-services \
  bound_service_account_names=forgepay-services \
  bound_service_account_namespaces=forgepay \
  policies=forgepay-admin \
  ttl=1h
```

## Adding Secrets

### Manual (Development/Testing)

```bash
# Add a secret to Vault
vault kv put forgepay/payment-engine/api_key \
  value="test_key_xxxx" \
  description="Hyperswitch test API key"

# Retrieve a secret
vault kv get forgepay/payment-engine/api_key

# List all secrets in a path
vault kv list forgepay/payment-engine/
```

### Automated via CI/CD

```yaml
# Example: GitHub Actions workflow to store secrets
- name: Store secret in Vault
  env:
    VAULT_ADDR: https://vault.example.com
    VAULT_TOKEN: ${{ secrets.VAULT_TOKEN }}
  run: |
    vault kv put forgepay/api-keys/circle \
      api_key="${{ secrets.CIRCLE_API_KEY }}" \
      timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Using Secrets in Kubernetes

### 1. Via External Secrets Operator (Recommended)

```yaml
# forgepay/infra/helm/forgepay-stack/templates/external-secrets.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-store
  namespace: forgepay
spec:
  provider:
    vault:
      server: https://vault.example.com
      path: forgepay
      auth:
        kubernetes:
          mountPath: kubernetes
          role: forgepay-services

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: payment-engine-secrets
  namespace: forgepay
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-store
    kind: SecretStore
  target:
    name: payment-engine-env
    creationPolicy: Owner
    template:
      type: Opaque
      data:
        PAYMENT_ENGINE_API_KEY: "{{ .api_key }}"
  data:
    - secretKey: api_key
      remoteRef:
        key: payment-engine/api_key
```

Then reference in Deployment:

```yaml
envFrom:
  - secretRef:
      name: payment-engine-env
```

### 2. Via Init Container

```yaml
# Inject secrets from Vault into pod at startup
initContainers:
  - name: vault-init
    image: vault:latest
    env:
      - name: VAULT_ADDR
        value: https://vault.example.com
      - name: VAULT_TOKEN
        valueFrom:
          fieldRef:
            fieldPath: metadata.annotations['vault.hashicorp.com/agent-inject-token']
    command:
      - sh
      - -c
      - |
        vault kv get -field=api_key forgepay/payment-engine/api_key > /tmp/secrets/api_key
        chmod 600 /tmp/secrets/api_key
    volumeMounts:
      - name: secrets
        mountPath: /tmp/secrets
```

## Environment-Specific Secrets

### Development (`.env` file)
```bash
# .env.development (DO NOT COMMIT)
PAYMENT_ENGINE_API_KEY=test_key_dev
WEBHOOK_SIGNING_SECRET=dev_secret_do_not_use
CRYPTO_GATEWAY_SEED=test_seed
# ... etc
```

**Never commit `.env` files to git!** Add to `.gitignore`:
```
.env
.env.*.local
.env.local
```

### Staging

Secrets stored in Vault at `forgepay/staging/*`

```bash
# Retrieve via Vault CLI
vault kv get -format=json forgepay/staging/all > staging-secrets.json
```

### Production

Secrets stored in Vault at `forgepay/production/*`

```bash
# Production secrets require MFA
vault login -method=oidc

# Retrieve specific secret
vault kv get forgepay/production/payment-engine/api_key
```

## Rotating Secrets

### API Keys

```bash
# 1. Generate new key in the external service (e.g., Hyperswitch dashboard)
# 2. Store new key in Vault
vault kv put forgepay/production/payment-engine/api_key \
  value="new_key_xxxx" \
  previous_key="old_key_yyyy" \
  rotation_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 3. Update all services to use new key (via rolling deployment)
kubectl rollout restart deployment/payment-engine -n forgepay

# 4. Verify old key is no longer active in external service
# 5. Clean up old key from Vault after verification period
vault kv delete-version-metadata forgepay/production/payment-engine/api_key --versions=1
```

### Database Passwords

```bash
# 1. Change password in PostgreSQL
psql -h postgres-primary -U postgres -c "ALTER USER forgepay WITH PASSWORD 'new_password';"

# 2. Update Vault
vault kv put forgepay/production/database/password value="new_password"

# 3. Restart all services that use database
kubectl rollout restart deployment -n forgepay

# 4. Verify new password works
psql -h postgres-primary -U forgepay -W
```

## Audit & Compliance

### Enable Audit Logging

```bash
# Enable file audit backend
vault audit enable file file_path=/var/log/vault-audit.log

# Monitor audit logs
tail -f /var/log/vault-audit.log | jq .
```

### Access Control

- **Read-only**: SDK teams, frontend developers
- **Read-write**: DevOps, platform engineers
- **Admin**: Only CTO and on-call engineer

```bash
# Create read-only policy
cat > /tmp/read-only.hcl << 'EOF'
path "forgepay/*" {
  capabilities = ["read", "list"]
}
EOF

vault write sys/policies/acl/forgepay-read-only @/tmp/read-only.hcl
```

### Compliance Checklist

- [ ] No secrets committed to git
- [ ] All API keys have expiration dates
- [ ] Database passwords rotated every 90 days
- [ ] Audit logs retained for 2 years
- [ ] Access reviewed quarterly
- [ ] MFA enabled for production access
- [ ] Backup encryption keys stored separately

## Troubleshooting

### Secret Not Found

```bash
# List all paths to find the secret
vault kv list forgepay/

# Check if secret exists at specific path
vault kv get forgepay/production/payment-engine/api_key
```

### Permission Denied

```bash
# Check your current auth method
vault auth list

# Verify your token capabilities
vault token lookup

# Request elevated access from vault admin
```

### Secret Leaked

1. **Immediately rotate** the compromised secret
2. **Create incident** in your incident management system
3. **Audit all uses** of the secret in logs
4. **Update dependent services** to new value
5. **Document** the incident post-mortem

## References

- [Vault Documentation](https://www.vaultproject.io/docs)
- [External Secrets Operator](https://external-secrets.io)
- [CIS Kubernetes Benchmarks](https://www.cisecurity.org/benchmark/kubernetes)
- [OWASP: Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
