# ForgePay Vault Secrets Ops Runbook

HashiCorp Vault is the single source of truth for all ForgePay service secrets. This directory contains everything needed to bootstrap and maintain Vault for ForgePay.

## Files

| File | Purpose |
|---|---|
| `setup.sh` | One-shot bootstrap: enables KV v2, writes policy, configures K8s auth, seeds secrets |
| `policy.hcl` | `forgepay-services` policy — grants services read access to their own path |
| `vault-agent-config.hcl` | Vault Agent sidecar config for automatic token renewal and secret injection |
| `k8s-external-secrets.yaml` | ExternalSecrets Operator CRDs — syncs Vault KV to Kubernetes Secrets |

---

## Prerequisites

- Vault 1.15+ initialized and unsealed
- `vault` CLI installed (`brew install vault` or https://developer.hashicorp.com/vault/install)
- Admin token with `sys/mounts`, `sys/policy`, and `auth/kubernetes` permissions
- Kubernetes cluster with ExternalSecrets Operator installed (for `k8s-external-secrets.yaml`)

```bash
# Install ExternalSecrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

---

## Step-by-Step Setup

### 1. Export environment variables

```bash
export VAULT_ADDR=https://vault.forgepay.internal
export VAULT_TOKEN=<your-admin-token>
export KUBERNETES_HOST=https://<k8s-api-server>:6443
export K8S_NAMESPACE=forgepay            # Kubernetes namespace for service accounts
```

### 2. Run the bootstrap script

```bash
cd forgepay/infra/vault
bash setup.sh
```

This will:
- Enable KV v2 at `forgepay/`
- Write the `forgepay-services` Vault policy
- Enable and configure Kubernetes auth
- Create one auth role per service
- Seed all service secrets with `CHANGEME` placeholders

### 3. Replace CHANGEME values

```bash
# Update individual secrets
vault kv patch forgepay/mor-layer \
  JWT_SECRET="$(openssl rand -hex 32)" \
  HYPERSWITCH_WEBHOOK_SECRET="$(openssl rand -hex 32)"

vault kv patch forgepay/dashboard \
  NEXTAUTH_SECRET="$(openssl rand -hex 32)"

vault kv patch forgepay/billing-engine \
  KILLBILL_ADMIN_PASSWORD="<real-password>" \
  KILLBILL_WEBHOOK_SECRET="$(openssl rand -hex 32)"

# Verify a secret
vault kv get forgepay/mor-layer
```

### 4. Apply ExternalSecrets manifests

```bash
kubectl apply -f forgepay/infra/vault/k8s-external-secrets.yaml -n forgepay

# Check sync status
kubectl get externalsecrets -n forgepay
kubectl describe externalsecret enterprise-treasury-secrets -n forgepay
```

### 5. Verify secret injection in pods

```bash
# Pod with Vault Agent sidecar: secrets land at /vault/secrets/<service>.env
kubectl exec -it deploy/mor-layer -n forgepay -c vault-agent -- \
  cat /vault/secrets/mor-layer.env
```

---

## Secret Paths Reference

| Service | Vault Path | Keys |
|---|---|---|
| enterprise-treasury | `forgepay/enterprise-treasury` | DATABASE_URL, VALID_API_KEYS, ALERT_WEBHOOK_URL, YIELD_ENGINE_URL |
| agent-credit-lines | `forgepay/agent-credit-lines` | DATABASE_URL, ENTERPRISE_TREASURY_API_KEY |
| agent-identity | `forgepay/agent-identity` | DATABASE_URL, VALID_API_KEYS, KYAPAY_PRIVATE_KEY_PEM |
| unified-router | `forgepay/unified-router` | DATABASE_URL, VALID_API_KEYS, REDIS_URL |
| billing-engine | `forgepay/billing-engine` | DATABASE_URL, KILLBILL_ADMIN_PASSWORD, KILLBILL_WEBHOOK_SECRET |
| mor-layer | `forgepay/mor-layer` | DATABASE_URL, JWT_SECRET, HYPERSWITCH_WEBHOOK_SECRET, AUDITOR_SEED_HEX, AVALARA_API_KEY, TAXJAR_TOKEN |
| bank-connectivity | `forgepay/bank-connectivity` | JWT_SECRET, PLAID_CLIENT_ID, PLAID_SECRET, ENCRYPTION_KEY, INTERNAL_SECRET |
| dashboard | `forgepay/dashboard` | NEXTAUTH_SECRET, HYPERSWITCH_MERCHANT_API_KEY, KILLBILL_API_SECRET |

---

## Secret Rotation

### Rotate a single key

```bash
# Patch updates only the specified field(s); other fields are unchanged
vault kv patch forgepay/<service> KEY="new-value"

# ExternalSecrets will pick up the new version within `refreshInterval` (default 1h).
# Force immediate refresh:
kubectl annotate externalsecret <service>-secrets \
  force-sync="$(date +%s)" --overwrite -n forgepay
```

### Full rotation workflow

1. Generate new secret values
2. `vault kv patch` to write new values
3. Wait for ExternalSecrets refresh (or force it as above)
4. Kubernetes rolls out new pod spec with updated Secret
5. Verify with `kubectl rollout status deploy/<service> -n forgepay`

### Audit secret versions

```bash
# List all versions of a secret
vault kv metadata get forgepay/mor-layer

# Read a specific version
vault kv get -version=2 forgepay/mor-layer
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ExternalSecret` stuck in `SecretSyncedError` | Vault policy missing read on path | Check `vault kv get forgepay/<service>` as the service SA token; re-apply `policy.hcl` |
| Pod fails with "required secrets missing" | ExternalSecret not synced yet | `kubectl describe externalsecret <service>-secrets -n forgepay` |
| Vault Agent token renewal failing | K8s auth role expired / SA rotated | Re-run `setup.sh` role creation steps |
| `vault secrets enable` permission denied | Token lacks `sys/mounts` capability | Use a root or admin token |
| `kv_put: already exists` warning | Secret was written in a prior run | Use `vault kv patch` to update individual fields |

### Check Vault Agent logs in a pod

```bash
kubectl logs deploy/<service> -c vault-agent -n forgepay --follow
```

### Force re-auth from a pod

```bash
kubectl delete pod -l app=<service> -n forgepay
# New pod will re-authenticate via Kubernetes auth on startup
```
