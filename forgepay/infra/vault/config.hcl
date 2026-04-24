# Vault Configuration for ForgePay
# Manages cryptographic keys, auditor secrets, and payment processor credentials

# Authentication: Enable Kubernetes auth method for EKS
path "auth/kubernetes/config" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

path "auth/kubernetes/role/forgepay-auditor" {
  capabilities = ["create", "read", "update", "delete"]
}

path "auth/kubernetes/role/forgepay-checkout" {
  capabilities = ["create", "read", "update", "delete"]
}

# Secret Engine: KV v2 for general secrets
path "secret/data/forgepay/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

path "secret/metadata/forgepay/*" {
  capabilities = ["list", "read"]
}

# Auditor Key Management
path "secret/data/forgepay/auditor/keys/current" {
  capabilities = ["read"]
}

path "secret/data/forgepay/auditor/keys/archive/*" {
  capabilities = ["read", "list"]
}

path "secret/data/forgepay/auditor/keys/rotation-log" {
  capabilities = ["read", "create", "update"]
}

# Payment Processor Credentials
path "secret/data/forgepay/integrations/stripe" {
  capabilities = ["read"]
}

path "secret/data/forgepay/integrations/hyperswitch" {
  capabilities = ["read"]
}

path "secret/data/forgepay/integrations/polygon-rpc" {
  capabilities = ["read"]
}

path "secret/data/forgepay/integrations/ethereum-rpc" {
  capabilities = ["read"]
}

path "secret/data/forgepay/integrations/base-rpc" {
  capabilities = ["read"]
}

path "secret/data/forgepay/integrations/arbitrum-rpc" {
  capabilities = ["read"]
}

# Database Credentials
path "secret/data/forgepay/database/postgres" {
  capabilities = ["read"]
}

path "secret/data/forgepay/database/redis" {
  capabilities = ["read"]
}

# Webhook Signing Keys
path "secret/data/forgepay/webhooks/*" {
  capabilities = ["read", "list"]
}

# PKI: For future TLS certificate management
path "pki/issue/forgepay" {
  capabilities = ["create", "update"]
}

# Audit Logging
path "sys/audit" {
  capabilities = ["read"]
}

path "sys/audit/file" {
  capabilities = ["create", "update", "delete"]
}

# Health Check
path "sys/health" {
  capabilities = ["read"]
}
