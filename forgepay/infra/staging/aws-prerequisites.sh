#!/usr/bin/env bash
# =============================================================================
# ForgePay Staging — AWS Prerequisites Bootstrap
# =============================================================================
# Sets up all AWS resources that must exist BEFORE running Terraform.
# Safe to run multiple times (idempotent).
#
# Usage:
#   ./aws-prerequisites.sh [af-south-1|us-east-1|eu-west-2]
#
# What this creates:
#   - S3 bucket for Terraform state (versioning + AES-256 encryption)
#   - DynamoDB table for Terraform state locking
#   - KMS key for staging secrets encryption
#   - ECR repositories for each ForgePay service
#   - IAM role for EKS cluster (with managed policies)
#   - IAM role for EKS node group
#
# Prerequisites:
#   aws CLI >= 2.x with credentials configured (AdministratorAccess or equivalent)
#
# To make executable:
#   chmod +x aws-prerequisites.sh

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

REGION="${1:-}"
if [[ -z "${REGION}" ]]; then
  echo "Usage: $0 [af-south-1|us-east-1|eu-west-2]"
  exit 1
fi

case "${REGION}" in
  af-south-1|us-east-1|eu-west-2) ;;
  *) echo "ERROR: Invalid region '${REGION}'. Must be one of: af-south-1, us-east-1, eu-west-2"; exit 1 ;;
esac

# Derived names
TF_STATE_BUCKET="forgepay-terraform-state-${REGION}"
TF_LOCKS_TABLE="forgepay-terraform-locks-${REGION}"
KMS_KEY_ALIAS="alias/forgepay-staging-${REGION}"
EKS_CLUSTER_ROLE_NAME="forgepay-staging-eks-cluster-role-${REGION}"
EKS_NODE_ROLE_NAME="forgepay-staging-eks-node-role-${REGION}"

# All ForgePay service ECR repositories
SERVICES=(
  "forgepay/payment-engine"
  "forgepay/unified-router"
  "forgepay/mor-layer"
  "forgepay/billing-engine"
  "forgepay/stablecoin-gateway"
  "forgepay/crypto-gateway"
  "forgepay/yield-engine"
  "forgepay/rwa-registry"
  "forgepay/enterprise-treasury"
  "forgepay/agent-identity"
  "forgepay/agent-negotiation"
  "forgepay/agent-decision-framework"
  "forgepay/agent-credit-lines"
  "forgepay/compliance-monitor"
  "forgepay/liquidity-forecaster"
  "forgepay/bank-connectivity"
  "forgepay/chain-sync"
  "forgepay/bank-whitelabel"
  "forgepay/accounts-service"
  "forgepay/institutional-reporting"
  "forgepay/dashboard"
)

# =============================================================================
# Colors & logging
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
RESET='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${RESET}   $(date -u +%H:%M:%S) $*"; }
log_ok()      { echo -e "${GREEN}[OK]${RESET}     $(date -u +%H:%M:%S) $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}   $(date -u +%H:%M:%S) $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET}  $(date -u +%H:%M:%S) $*" >&2; }
log_skip()    { echo -e "${CYAN}[SKIP]${RESET}   $(date -u +%H:%M:%S) $*"; }
log_section() {
  echo ""
  echo -e "${BOLD}${MAGENTA}┌──────────────────────────────────────────────────────────┐${RESET}"
  echo -e "${BOLD}${MAGENTA}│  $*$(printf '%*s' $((56 - ${#*})) '')│${RESET}"
  echo -e "${BOLD}${MAGENTA}└──────────────────────────────────────────────────────────┘${RESET}"
  echo ""
}

die() { log_error "$*"; exit 1; }

# =============================================================================
# Verify AWS credentials
# =============================================================================

check_aws() {
  log_section "Verifying AWS Credentials"

  if ! command -v aws &>/dev/null; then
    die "AWS CLI not found. Install it: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  fi

  local identity
  identity=$(aws sts get-caller-identity --region "${REGION}" 2>/dev/null) \
    || die "AWS credentials not configured or not valid. Run: aws configure"

  AWS_ACCOUNT_ID=$(echo "${identity}" | jq -r '.Account')
  local caller_arn
  caller_arn=$(echo "${identity}" | jq -r '.Arn')

  log_ok "AWS Account: ${AWS_ACCOUNT_ID}"
  log_ok "Caller ARN : ${caller_arn}"
  log_ok "Region     : ${REGION}"
}

# =============================================================================
# S3 Terraform State Bucket
# =============================================================================

create_tf_state_bucket() {
  log_section "S3 Terraform State Bucket"

  log_info "Checking bucket: ${TF_STATE_BUCKET}"

  if aws s3api head-bucket --bucket "${TF_STATE_BUCKET}" --region "${REGION}" 2>/dev/null; then
    log_skip "Bucket already exists: ${TF_STATE_BUCKET}"
  else
    log_info "Creating bucket: ${TF_STATE_BUCKET}"

    if [[ "${REGION}" == "us-east-1" ]]; then
      # us-east-1 does not accept LocationConstraint
      aws s3api create-bucket \
        --bucket "${TF_STATE_BUCKET}" \
        --region "${REGION}" \
        --output text >/dev/null
    else
      aws s3api create-bucket \
        --bucket "${TF_STATE_BUCKET}" \
        --region "${REGION}" \
        --create-bucket-configuration "LocationConstraint=${REGION}" \
        --output text >/dev/null
    fi
    log_ok "Bucket created: ${TF_STATE_BUCKET}"
  fi

  # Enable versioning
  aws s3api put-bucket-versioning \
    --bucket "${TF_STATE_BUCKET}" \
    --versioning-configuration Status=Enabled \
    --region "${REGION}" 2>/dev/null
  log_ok "Versioning enabled"

  # Enable server-side encryption
  aws s3api put-bucket-encryption \
    --bucket "${TF_STATE_BUCKET}" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        },
        "BucketKeyEnabled": true
      }]
    }' \
    --region "${REGION}" 2>/dev/null
  log_ok "AES-256 encryption enabled"

  # Block all public access
  aws s3api put-public-access-block \
    --bucket "${TF_STATE_BUCKET}" \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
    --region "${REGION}" 2>/dev/null
  log_ok "Public access blocked"

  log_ok "S3 state bucket ready: s3://${TF_STATE_BUCKET}/"
}

# =============================================================================
# DynamoDB Terraform State Lock Table
# =============================================================================

create_tf_locks_table() {
  log_section "DynamoDB State Lock Table"

  log_info "Checking DynamoDB table: ${TF_LOCKS_TABLE}"

  if aws dynamodb describe-table \
      --table-name "${TF_LOCKS_TABLE}" \
      --region "${REGION}" &>/dev/null; then
    log_skip "DynamoDB table already exists: ${TF_LOCKS_TABLE}"
    return 0
  fi

  log_info "Creating DynamoDB table: ${TF_LOCKS_TABLE}"
  aws dynamodb create-table \
    --table-name "${TF_LOCKS_TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${REGION}" \
    --output text >/dev/null

  log_info "Waiting for table to become active..."
  aws dynamodb wait table-exists \
    --table-name "${TF_LOCKS_TABLE}" \
    --region "${REGION}"

  # Enable point-in-time recovery
  aws dynamodb update-continuous-backups \
    --table-name "${TF_LOCKS_TABLE}" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
    --region "${REGION}" \
    --output text >/dev/null

  log_ok "DynamoDB lock table ready: ${TF_LOCKS_TABLE}"
}

# =============================================================================
# KMS Key for Secrets Encryption
# =============================================================================

create_kms_key() {
  log_section "KMS Key — Secrets Encryption"

  log_info "Checking KMS key alias: ${KMS_KEY_ALIAS}"

  if aws kms describe-key \
      --key-id "${KMS_KEY_ALIAS}" \
      --region "${REGION}" &>/dev/null; then
    log_skip "KMS key already exists: ${KMS_KEY_ALIAS}"
    return 0
  fi

  log_info "Creating KMS key for staging secrets encryption..."
  local key_id
  key_id=$(aws kms create-key \
    --description "ForgePay staging secrets encryption key - ${REGION}" \
    --key-usage ENCRYPT_DECRYPT \
    --key-spec SYMMETRIC_DEFAULT \
    --region "${REGION}" \
    --tags TagKey=Project,TagValue=ForgePay TagKey=Environment,TagValue=staging \
    --query 'KeyMetadata.KeyId' \
    --output text)

  aws kms create-alias \
    --alias-name "${KMS_KEY_ALIAS}" \
    --target-key-id "${key_id}" \
    --region "${REGION}"

  # Enable automatic key rotation
  aws kms enable-key-rotation \
    --key-id "${key_id}" \
    --region "${REGION}"

  KMS_KEY_ARN=$(aws kms describe-key \
    --key-id "${key_id}" \
    --region "${REGION}" \
    --query 'KeyMetadata.Arn' \
    --output text)

  log_ok "KMS key created: ${KMS_KEY_ALIAS} (${KMS_KEY_ARN})"
}

# =============================================================================
# IAM Roles for EKS
# =============================================================================

create_iam_roles() {
  log_section "IAM Roles — EKS Cluster and Node Group"

  # EKS Cluster Role
  log_info "Checking EKS cluster IAM role: ${EKS_CLUSTER_ROLE_NAME}"
  if aws iam get-role --role-name "${EKS_CLUSTER_ROLE_NAME}" &>/dev/null; then
    log_skip "EKS cluster role already exists: ${EKS_CLUSTER_ROLE_NAME}"
  else
    log_info "Creating EKS cluster IAM role..."
    aws iam create-role \
      --role-name "${EKS_CLUSTER_ROLE_NAME}" \
      --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
          "Effect": "Allow",
          "Principal": {"Service": "eks.amazonaws.com"},
          "Action": "sts:AssumeRole"
        }]
      }' \
      --tags Key=Project,Value=ForgePay Key=Environment,Value=staging \
      --output text >/dev/null

    aws iam attach-role-policy \
      --role-name "${EKS_CLUSTER_ROLE_NAME}" \
      --policy-arn "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"

    log_ok "EKS cluster role created: ${EKS_CLUSTER_ROLE_NAME}"
  fi

  # EKS Node Group Role
  log_info "Checking EKS node group IAM role: ${EKS_NODE_ROLE_NAME}"
  if aws iam get-role --role-name "${EKS_NODE_ROLE_NAME}" &>/dev/null; then
    log_skip "EKS node role already exists: ${EKS_NODE_ROLE_NAME}"
  else
    log_info "Creating EKS node group IAM role..."
    aws iam create-role \
      --role-name "${EKS_NODE_ROLE_NAME}" \
      --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
          "Effect": "Allow",
          "Principal": {"Service": "ec2.amazonaws.com"},
          "Action": "sts:AssumeRole"
        }]
      }' \
      --tags Key=Project,Value=ForgePay Key=Environment,Value=staging \
      --output text >/dev/null

    for policy in \
      "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy" \
      "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy" \
      "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly" \
      "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"; do
      aws iam attach-role-policy \
        --role-name "${EKS_NODE_ROLE_NAME}" \
        --policy-arn "${policy}"
    done

    log_ok "EKS node role created: ${EKS_NODE_ROLE_NAME}"
  fi
}

# =============================================================================
# ECR Repositories
# =============================================================================

create_ecr_repos() {
  log_section "ECR Repositories — All ForgePay Services"

  for repo in "${SERVICES[@]}"; do
    log_info "ECR repo: ${repo}"

    if aws ecr describe-repositories \
        --repository-names "${repo}" \
        --region "${REGION}" &>/dev/null; then
      log_skip "  Already exists: ${repo}"
      continue
    fi

    aws ecr create-repository \
      --repository-name "${repo}" \
      --region "${REGION}" \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 \
      --tags Key=Project,Value=ForgePay Key=Environment,Value=staging \
      --output text >/dev/null

    # Set lifecycle policy to keep only last 10 images per repo (staging cost saving)
    aws ecr put-lifecycle-policy \
      --repository-name "${repo}" \
      --region "${REGION}" \
      --lifecycle-policy-text '{
        "rules": [{
          "rulePriority": 1,
          "description": "Keep only last 10 images",
          "selection": {
            "tagStatus": "any",
            "countType": "imageCountMoreThan",
            "countNumber": 10
          },
          "action": {"type": "expire"}
        }]
      }' \
      --output text >/dev/null

    log_ok "  Created: ${repo}"
  done

  local registry="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
  log_ok "ECR registry: ${registry}"
  log_info "Authenticate Docker: aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${registry}"
}

# =============================================================================
# Print summary
# =============================================================================

print_summary() {
  local registry="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${GREEN}║  AWS Prerequisites COMPLETE                                  ║${RESET}"
  echo -e "${BOLD}${GREEN}║  Region: ${REGION}$(printf '%*s' $((52 - ${#REGION})) '')║${RESET}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "${BOLD}Resources created/verified:${RESET}"
  echo -e "  S3 state bucket  : s3://${TF_STATE_BUCKET}/"
  echo -e "  DynamoDB table   : ${TF_LOCKS_TABLE}"
  echo -e "  KMS key alias    : ${KMS_KEY_ALIAS}"
  echo -e "  EKS cluster role : ${EKS_CLUSTER_ROLE_NAME}"
  echo -e "  EKS node role    : ${EKS_NODE_ROLE_NAME}"
  echo -e "  ECR registry     : ${registry}"
  echo -e "  ECR repos        : ${#SERVICES[@]} repositories"
  echo ""
  echo -e "${BOLD}Next steps:${RESET}"
  echo -e "  1. Create secrets in AWS Secrets Manager (see SECRETS_SETUP.md)"
  echo -e "  2. Copy .env.staging.example → .env.staging and fill in values"
  echo -e "  3. Run: ./deploy-staging.sh ${REGION}"
  echo ""
}

# =============================================================================
# MAIN
# =============================================================================

main() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${CYAN}║  ForgePay AWS Prerequisites Bootstrap                        ║${RESET}"
  echo -e "${BOLD}${CYAN}║  Region: ${REGION}$(printf '%*s' $((52 - ${#REGION})) '')║${RESET}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  check_aws
  create_tf_state_bucket
  create_tf_locks_table
  create_kms_key
  create_iam_roles
  create_ecr_repos
  print_summary
}

main "$@"
