variable "environment" { type = string }

variable "name_prefix" {
  type        = string
  default     = "forgepay"
  description = "Prefix for key aliases and IAM policy names."
}

# ── Stablecoin-gateway deposit-key wrapping ──────────────────────────────────

variable "deposit_key_enabled" {
  type        = bool
  default     = true
  description = "Create the KMS key that wraps the stablecoin-gateway's deposit-key data keys (KEY_WRAP_PROVIDER=awskms)."
}

variable "deposit_key_user_arns" {
  type        = list(string)
  default     = []
  description = <<-EOT
    IAM role ARNs (normally the gateway's IRSA role) allowed to kms:Encrypt/kms:Decrypt with the
    encryption context purpose = var.deposit_key_purpose. The gateway uses the constant context
    "deposit-keys" (src/lib/keystore.ts). When non-empty and enforce_in_key_policy is true, every
    other principal is denied use of the key.
  EOT
}

variable "deposit_key_purpose" {
  type        = string
  default     = "deposit-keys"
  description = "Value of the kms:EncryptionContext:purpose condition. Must match the context the gateway sends."
}

# ── MPC node seal keys ───────────────────────────────────────────────────────

variable "mpc_node_ids" {
  type        = set(string)
  default     = []
  description = <<-EOT
    One seal key is created per node id (for_each). Each node of a threshold cluster should sit in its OWN
    trust domain, so in production call this module once per node/account with a provider alias and a
    single id (see examples/threshold-custody). Passing several ids here puts all those keys in one account
    and therefore one trust domain.
  EOT
}

variable "mpc_node_user_arns" {
  type        = map(list(string))
  default     = {}
  description = <<-EOT
    Node id -> IAM role ARNs (the node's IRSA role) allowed kms:GenerateDataKey and kms:Decrypt on that
    node's key, only with the encryption context mpc-node = <node id>. A node id missing from the map gets a
    key nobody can use until the map is filled in.
  EOT
}

variable "allow_seal_check_context" {
  type        = bool
  default     = true
  description = <<-EOT
    `mpc-node seal-check -provider awskms` wraps a throwaway key under the node id "seal-check", not the real
    node id (internal/mpc/sealcheck.go). With this true the key policy and IAM policy also admit the context
    mpc-node = "seal-check" so the check can run with the node's own role. The throwaway data key is never
    stored. Set false once the check has passed in your account to tighten the policy to the node id only.
  EOT
}

# ── Common ───────────────────────────────────────────────────────────────────

variable "key_admin_arns" {
  type        = list(string)
  default     = []
  description = "IAM principals that may administer (not use) the keys. The account root always keeps full control, as KMS requires to avoid lock-out."
}

variable "enforce_in_key_policy" {
  type        = bool
  default     = true
  description = <<-EOT
    Add an explicit Deny to each key policy for crypto operations by anyone not listed in the *_user_arns
    variable, and for any encryption context other than the expected one. Without it, any IAM principal in the
    account with kms:* could use the key through the account-root statement, bypassing the context condition.
  EOT
}

variable "deletion_window_in_days" {
  type        = number
  default     = 30
  description = "Waiting period before a scheduled key deletion takes effect (7-30)."
  validation {
    condition     = var.deletion_window_in_days >= 7 && var.deletion_window_in_days <= 30
    error_message = "deletion_window_in_days must be between 7 and 30."
  }
}

variable "create_iam_policies" {
  type        = bool
  default     = true
  description = "Also create customer-managed IAM policies (least privilege, with the encryption-context condition) that can be attached to the pods' roles."
}

variable "tags" {
  type    = map(string)
  default = {}
}
