#!/usr/bin/env bash
# =============================================================================
# ForgePay Staging Teardown Script
# =============================================================================
# Safely tears down the ForgePay staging environment.
# Runs helm uninstall first, then terraform destroy.
#
# Usage:
#   ./teardown-staging.sh [af-south-1|us-east-1|eu-west-2] [OPTIONS]
#
# Options:
#   --skip-helm-uninstall  Skip Helm uninstall (resources already removed)
#   --skip-terraform       Skip Terraform destroy (preserve infra)
#   --force                Skip interactive confirmation prompt
#   --help                 Show this message
#
# WARNING: This permanently destroys the staging environment.
# ECR repositories and S3 state buckets are NOT destroyed automatically.
#
# To make scripts executable:
#   chmod +x teardown-staging.sh

set -euo pipefail

# =============================================================================
# Directories
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
TF_DIR="${REPO_ROOT}/forgepay/infra/terraform"

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
log_section() {
  echo ""
  echo -e "${BOLD}${MAGENTA}┌──────────────────────────────────────────────────────────┐${RESET}"
  echo -e "${BOLD}${MAGENTA}│  $*$(printf '%*s' $((56 - ${#*})) '')│${RESET}"
  echo -e "${BOLD}${MAGENTA}└──────────────────────────────────────────────────────────┘${RESET}"
  echo ""
}

die() {
  log_error "$*"
  exit 1
}

# =============================================================================
# Defaults
# =============================================================================

REGION=""
NAMESPACE="forgepay-staging"
SKIP_HELM_UNINSTALL=false
SKIP_TERRAFORM=false
FORCE=false

# =============================================================================
# Parse arguments
# =============================================================================

usage() {
  grep '^#' "${BASH_SOURCE[0]}" | grep -v '#!/' | sed 's/^# //' | sed 's/^#//'
  exit 0
}

if [[ $# -eq 0 ]]; then
  usage
fi

REGION="$1"
shift

case "${REGION}" in
  af-south-1|us-east-1|eu-west-2) ;;
  --help|-h) usage ;;
  *) die "Invalid region '${REGION}'. Must be one of: af-south-1, us-east-1, eu-west-2" ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-helm-uninstall) SKIP_HELM_UNINSTALL=true ;;
    --skip-terraform)      SKIP_TERRAFORM=true ;;
    --force)               FORCE=true ;;
    --help|-h)             usage ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done

TFVARS_FILE="${SCRIPT_DIR}/terraform/${REGION}.tfvars"
TF_STATE_BUCKET="forgepay-terraform-state-${REGION}"
TF_LOCKS_TABLE="forgepay-terraform-locks-${REGION}"
TF_STATE_KEY="forgepay/staging/${REGION}/terraform.tfstate"

# =============================================================================
# Banner
# =============================================================================

echo ""
echo -e "${BOLD}${RED}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${RED}║        ForgePay Staging TEARDOWN                             ║${RESET}"
echo -e "${BOLD}${RED}║        Region : ${REGION}$(printf '%*s' $((47 - ${#REGION})) '')║${RESET}"
echo -e "${BOLD}${RED}║        Time   : $(date -u +'%Y-%m-%d %H:%M UTC')$(printf '%*s' $((21)) '')║${RESET}"
echo -e "${BOLD}${RED}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${RED}${BOLD}WARNING: This will PERMANENTLY DESTROY the ${REGION} staging environment.${RESET}"
echo -e "${YELLOW}  - EKS cluster and all workloads will be deleted${RESET}"
echo -e "${YELLOW}  - RDS database will be deleted (final snapshot taken)${RESET}"
echo -e "${YELLOW}  - ElastiCache Redis will be deleted${RESET}"
echo -e "${YELLOW}  - VPC and networking resources will be deleted${RESET}"
echo -e "${CYAN}  (ECR repositories and S3 state buckets are preserved)${RESET}"
echo ""

# =============================================================================
# Confirmation prompt
# =============================================================================

if ! $FORCE; then
  echo -e "${BOLD}To confirm destruction, type exactly:${RESET}"
  echo -e "  ${YELLOW}yes I want to destroy staging${RESET}"
  echo ""
  read -r -p "Confirmation: " confirmation

  if [[ "${confirmation}" != "yes I want to destroy staging" ]]; then
    log_info "Teardown cancelled — confirmation phrase did not match."
    exit 0
  fi
  echo ""
fi

log_warn "Teardown confirmed. Proceeding..."

# =============================================================================
# STEP 1: Helm uninstall
# =============================================================================

helm_uninstall() {
  log_section "Step 1: Helm Uninstall — forgepay-stack"

  if $SKIP_HELM_UNINSTALL; then
    log_warn "--skip-helm-uninstall set: skipping Helm uninstall"
    return 0
  fi

  # Ensure kubeconfig is configured
  log_info "Updating kubeconfig for cluster forgepay-staging in ${REGION}..."
  if aws eks update-kubeconfig \
      --region "${REGION}" \
      --name "forgepay-staging" \
      --alias "forgepay-staging-${REGION}" 2>/dev/null; then
    log_ok "kubeconfig updated"
  else
    log_warn "Could not update kubeconfig — cluster may already be gone"
    log_warn "Skipping Helm uninstall and proceeding to Terraform destroy"
    return 0
  fi

  if ! kubectl cluster-info &>/dev/null; then
    log_warn "Cluster not reachable — skipping Helm uninstall"
    return 0
  fi

  # Check if release exists
  if helm status forgepay-stack --namespace "${NAMESPACE}" &>/dev/null; then
    log_info "Uninstalling Helm release: forgepay-stack"
    if helm uninstall forgepay-stack \
        --namespace "${NAMESPACE}" \
        --wait \
        --timeout 5m; then
      log_ok "Helm release uninstalled: forgepay-stack"
    else
      log_warn "Helm uninstall encountered errors — continuing with Terraform destroy"
    fi
  else
    log_info "Helm release 'forgepay-stack' not found (already removed or never deployed)"
  fi

  # Clean up namespace resources that Helm doesn't own (e.g., secrets we created)
  log_info "Cleaning up namespace resources..."
  kubectl delete secret forgepay-staging-env forgepay-db-credentials \
    --namespace "${NAMESPACE}" --ignore-not-found=true || true

  # Delete the namespace itself
  if kubectl get namespace "${NAMESPACE}" &>/dev/null; then
    log_info "Deleting namespace: ${NAMESPACE}"
    kubectl delete namespace "${NAMESPACE}" --wait=true --timeout=5m || \
      log_warn "Namespace deletion timed out — it may still be terminating"
    log_ok "Namespace ${NAMESPACE} deleted"
  fi
}

# =============================================================================
# STEP 2: Terraform destroy
# =============================================================================

terraform_destroy() {
  log_section "Step 2: Terraform Destroy — AWS Infrastructure"

  if $SKIP_TERRAFORM; then
    log_warn "--skip-terraform set: skipping Terraform destroy"
    return 0
  fi

  if [[ ! -f "${TFVARS_FILE}" ]]; then
    die "Terraform vars file not found: ${TFVARS_FILE}"
  fi

  log_info "terraform init (backend: s3://${TF_STATE_BUCKET}/${TF_STATE_KEY})"
  terraform -chdir="${TF_DIR}" init \
    -backend-config="bucket=${TF_STATE_BUCKET}" \
    -backend-config="key=${TF_STATE_KEY}" \
    -backend-config="region=${REGION}" \
    -backend-config="dynamodb_table=${TF_LOCKS_TABLE}" \
    -backend-config="encrypt=true" \
    -reconfigure \
    -input=false

  log_info "terraform plan -destroy"
  terraform -chdir="${TF_DIR}" plan \
    -destroy \
    -var-file="${TFVARS_FILE}" \
    -var="db_username=placeholder" \
    -var="db_password=placeholder" \
    -var="alert_email=devops@forgepay.io" \
    -out="${TF_DIR}/.tfplan-destroy-${REGION}" \
    -input=false

  log_warn "About to run terraform destroy — this cannot be undone"
  log_info "Running terraform apply (destroy plan)..."
  terraform -chdir="${TF_DIR}" apply \
    -input=false \
    -auto-approve \
    "${TF_DIR}/.tfplan-destroy-${REGION}"

  rm -f "${TF_DIR}/.tfplan-destroy-${REGION}"
  log_ok "Terraform destroy complete"
}

# =============================================================================
# STEP 3: Cleanup summary
# =============================================================================

print_summary() {
  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${GREEN}║  ForgePay Staging Teardown COMPLETE                          ║${RESET}"
  echo -e "${BOLD}${GREEN}║  Region: ${REGION}$(printf '%*s' $((52 - ${#REGION})) '')║${RESET}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "${BOLD}Preserved (not destroyed):${RESET}"
  echo -e "  ECR repositories   : ${AWS_ACCOUNT_ID:-<account>}.dkr.ecr.${REGION}.amazonaws.com/forgepay/*"
  echo -e "  S3 state bucket    : s3://${TF_STATE_BUCKET}/"
  echo -e "  DynamoDB lock table: ${TF_LOCKS_TABLE}"
  echo ""
  echo -e "${BOLD}To redeploy:${RESET}"
  echo -e "  ${SCRIPT_DIR}/deploy-staging.sh ${REGION}"
  echo ""
}

# =============================================================================
# MAIN
# =============================================================================

# Get account ID for summary (best-effort)
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --region "${REGION}" --query 'Account' --output text 2>/dev/null || echo "")

helm_uninstall
terraform_destroy
print_summary
