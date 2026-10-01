variable "environment" { type = string }

variable "node_id" {
  type        = string
  description = "The MPC node whose share backups this bucket holds. One bucket per node: a bucket shared between nodes would put every share's backup in one place. Prefer an account other than the node's own (losing that account must not lose its backups); writer/pruner roles can be cross-account."
}

variable "bucket_name" {
  type        = string
  description = "Globally unique bucket name. The node's MPC_BACKUP_S3_BUCKET."
}

variable "name_prefix" {
  type    = string
  default = "forgepay"
}

variable "kms_key_arn" {
  type        = string
  default     = null
  description = "Existing KMS key for SSE-KMS. Null creates a dedicated key in this module (rotation on, 30-day deletion window)."
}

variable "writer_role_arns" {
  type        = list(string)
  description = "Roles that write backups (the node's IRSA role). The writer policy grants Put/Get/List and the KMS rights, never delete."
  validation {
    condition     = length(var.writer_role_arns) > 0
    error_message = "At least one writer role is required."
  }
}

variable "backup_pruner_role_arn" {
  type        = string
  description = <<-EOT
    The ONE role allowed to delete objects and object versions (s3:DeleteObject*). The bucket policy denies
    deletion to everyone else, including the account's administrators. The node prunes its own superseded
    backups after a reshare (backup_service.go prune -> S3 DeleteObject), so with the default design this is the
    node's own role: pass the same ARN as the writer and attach both the writer and pruner policies to it. Use a
    different role only if pruning is moved to a separate job.
  EOT
}

variable "noncurrent_version_expiration_days" {
  type        = number
  default     = 30
  description = <<-EOT
    Noncurrent object versions (what pruning leaves behind, since the bucket is versioned) are permanently
    removed after this many days. It is the time a PRUNED backup stays recoverable: long enough to undo a
    mistaken prune, but also exactly how long a retired share's backup keeps existing after a key rotation.
    Shorter is better for share hygiene; longer is better for recovery from operator error.
  EOT
  validation {
    condition     = var.noncurrent_version_expiration_days >= 1
    error_message = "noncurrent_version_expiration_days must be at least 1."
  }
}

variable "abort_incomplete_multipart_days" {
  type    = number
  default = 7
}

variable "object_lock_enabled" {
  type        = bool
  default     = false
  description = <<-EOT
    S3 Object Lock (WORM) on the bucket. TRADE-OFF — read before enabling:
      + Protects backups from deletion or overwrite by a compromised writer, pruner or admin until retention ends.
      - Locked versions CANNOT be deleted by anyone (COMPLIANCE) or only with a special bypass permission
        (GOVERNANCE) until object_lock_retention_days has passed. The node prunes old backups after a key
        rotation precisely so that old shares do not linger; with the lock on, a retired share's backup stays
        in the bucket for the whole retention period, which undoes part of what resharing is for (an attacker
        who later obtains the backup recipient key can read the old share).
      - Can only be switched on when the bucket is created; changing it later recreates the bucket.
    Default is off. If you enable it, keep retention short (days, not months) and prefer GOVERNANCE.
  EOT
}

variable "object_lock_mode" {
  type    = string
  default = "GOVERNANCE"
  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.object_lock_mode)
    error_message = "object_lock_mode must be GOVERNANCE or COMPLIANCE."
  }
}

variable "object_lock_retention_days" {
  type    = number
  default = 14
}

variable "create_iam_policies" {
  type        = bool
  default     = true
  description = "Create customer-managed IAM policies for the writer and the pruner."
}

variable "force_destroy" {
  type        = bool
  default     = false
  description = "Never true in production: it would let `terraform destroy` empty the bucket of share backups."
}

variable "tags" {
  type    = map(string)
  default = {}
}
