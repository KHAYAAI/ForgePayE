#!/usr/bin/env bash
# =============================================================================
# ForgePay Staging Deployment Script
# =============================================================================
# Usage:
#   ./deploy-staging.sh [af-south-1|us-east-1|eu-west-2] [OPTIONS]
#
# Options:
#   --skip-terraform      Skip Terraform apply (use existing infra)
#   --skip-helm           Skip Helm deploy (useful for infra-only changes)
#   --skip-smoke-tests    Skip post-deploy smoke tests
#   --dry-run             Show what would be done without making changes
#   --image-tag TAG       Docker image tag to deploy (default: staging)
#   --env-file FILE       Path to .env.staging file (default: ./forgepay/infra/staging/.env.staging)
#   --help                Show this message
#
# Prerequisites:
#   aws   >= 2.x    (configured with credentials)
#   kubectl         (any recent version)
#   helm  >= 3.14
#   terraform >= 1.6
#   docker >= 24.x
#   jq    (any version)
#   curl  (any version)
#
# Environment variables (override defaults):
#   AWS_PROFILE       AWS credentials profile (optional)
#   KUBECONFIG        Path to kubeconfig (default: ~/.kube/config)

set -euo pipefail

# =============================================================================
# Script directories (all paths are absolute)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
FORGEPAY_DIR="${REPO_ROOT}/forgepay"
INFRA_DIR="${FORGEPAY_DIR}/infra"
HELM_CHART_DIR="${INFRA_DIR}/helm/forgepay-stack"
TF_DIR="${INFRA_DIR}/terraform"

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
log_step()    { echo -e "  ${CYAN}▶${RESET} $*"; }

die() {
  log_error "$*"
  exit 1
}

# =============================================================================
# Defaults
# =============================================================================

REGION=""
NAMESPACE="forgepay-staging"
IMAGE_TAG="staging"
ENV_FILE="${SCRIPT_DIR}/.env.staging"
SKIP_TERRAFORM=false
SKIP_HELM=false
SKIP_SMOKE_TESTS=false
DRY_RUN=false
HELM_TIMEOUT="10m"
POD_READY_TIMEOUT=600   # 10 minutes in seconds

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
    --skip-terraform)  SKIP_TERRAFORM=true ;;
    --skip-helm)       SKIP_HELM=true ;;
    --skip-smoke-tests) SKIP_SMOKE_TESTS=true ;;
    --dry-run)         DRY_RUN=true ;;
    --image-tag)       IMAGE_TAG="$2"; shift ;;
    --image-tag=*)     IMAGE_TAG="${1#*=}" ;;
    --env-file)        ENV_FILE="$2"; shift ;;
    --env-file=*)      ENV_FILE="${1#*=}" ;;
    --help|-h)         usage ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done

# Region-specific derived values
TFVARS_FILE="${SCRIPT_DIR}/terraform/${REGION}.tfvars"
HELM_VALUES_FILE="${SCRIPT_DIR}/helm/${REGION}-values.yaml"
TF_STATE_BUCKET="forgepay-terraform-state-${REGION}"
TF_LOCKS_TABLE="forgepay-terraform-locks-${REGION}"
TF_STATE_KEY="forgepay/staging/${REGION}/terraform.tfstate"

case "${REGION}" in
  af-south-1) BASE_DOMAIN="staging.af.forgepay.io" ;;
  us-east-1)  BASE_DOMAIN="staging.us.forgepay.io" ;;
  eu-west-2)  BASE_DOMAIN="staging.eu.forgepay.io" ;;
esac

# =============================================================================
# Banner
# =============================================================================

print_banner() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${CYAN}║           ForgePay Staging Deployment                        ║${RESET}"
  echo -e "${BOLD}${CYAN}║           Region : ${REGION}$(printf '%*s' $((40 - ${#REGION})) '')║${RESET}"
  echo -e "${BOLD}${CYAN}║           Tag    : ${IMAGE_TAG}$(printf '%*s' $((40 - ${#IMAGE_TAG})) '')║${RESET}"
  echo -e "${BOLD}${CYAN}║           Time   : $(date -u +'%Y-%m-%d %H:%M UTC')$(printf '%*s' $((20)) '')║${RESET}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  if $DRY_RUN; then
    echo -e "${YELLOW}  ★ DRY RUN MODE — no changes will be applied ★${RESET}"
    echo ""
  fi
}

# =============================================================================
# STEP 1: Validate prerequisites
# =============================================================================

check_prerequisites() {
  log_section "Step 1: Validating Prerequisites"
  local failures=0

  local required_tools=(aws kubectl helm terraform jq curl docker)
  for tool in "${required_tools[@]}"; do
    if command -v "${tool}" &>/dev/null; then
      local version
      version=$("${tool}" --version 2>/dev/null | head -1 || echo "unknown")
      log_step "${tool}: ${version}"
    else
      log_error "Required tool not found: ${tool}"
      (( failures++ )) || true
    fi
  done

  # Terraform version check
  if command -v terraform &>/dev/null; then
    local tf_version
    tf_version=$(terraform version -json 2>/dev/null | jq -r '.terraform_version' 2>/dev/null || echo "0.0.0")
    local tf_major tf_minor
    tf_major=$(echo "${tf_version}" | cut -d. -f1)
    tf_minor=$(echo "${tf_version}" | cut -d. -f2)
    if [[ ${tf_major} -lt 1 ]] || [[ ${tf_major} -eq 1 && ${tf_minor} -lt 6 ]]; then
      log_error "Terraform >= 1.6 required, found ${tf_version}"
      (( failures++ )) || true
    fi
  fi

  # Helm version check
  if command -v helm &>/dev/null; then
    local helm_version
    helm_version=$(helm version --short 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if [[ "${helm_version}" -lt 3 ]]; then
      log_error "Helm >= 3.x required"
      (( failures++ )) || true
    fi
  fi

  # AWS credentials
  if ! $DRY_RUN; then
    log_info "Checking AWS credentials..."
    if aws sts get-caller-identity --region "${REGION}" &>/dev/null; then
      local identity
      identity=$(aws sts get-caller-identity --region "${REGION}" --query 'Arn' --output text)
      log_step "AWS identity: ${identity}"
    else
      log_error "AWS credentials not configured or not valid for region ${REGION}"
      (( failures++ )) || true
    fi
  fi

  # Required files
  if [[ ! -f "${TFVARS_FILE}" ]]; then
    log_error "Terraform vars file not found: ${TFVARS_FILE}"
    (( failures++ )) || true
  fi

  if [[ ! -f "${HELM_VALUES_FILE}" ]]; then
    log_error "Helm values file not found: ${HELM_VALUES_FILE}"
    (( failures++ )) || true
  fi

  if [[ ! -f "${HELM_CHART_DIR}/Chart.yaml" ]]; then
    log_error "Helm chart not found at: ${HELM_CHART_DIR}"
    (( failures++ )) || true
  fi

  # .env.staging file
  if [[ ! -f "${ENV_FILE}" ]]; then
    log_warn ".env.staging not found at ${ENV_FILE}"
    log_warn "Secrets will not be loaded into Kubernetes."
    log_warn "Copy .env.staging.example to .env.staging and fill in values."
  fi

  if [[ ${failures} -gt 0 ]]; then
    die "Prerequisites check failed with ${failures} error(s). See above."
  fi

  log_ok "All prerequisites satisfied."
}

# =============================================================================
# STEP 2: Terraform init + plan + apply
# =============================================================================

run_terraform() {
  log_section "Step 2: Terraform — Provisioning AWS Infrastructure"

  if $SKIP_TERRAFORM; then
    log_warn "--skip-terraform set: skipping Terraform apply"
    return 0
  fi

  # Inject DB credentials from env file or environment
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "${ENV_FILE}"
    set +a
  fi

  export TF_VAR_db_username="${DATABASE_USER:-forgepay_staging}"
  export TF_VAR_db_password="${DATABASE_PASSWORD:-}"
  export TF_VAR_alert_email="${ALERT_EMAIL:-devops@forgepay.io}"

  if [[ -z "${TF_VAR_db_password}" ]]; then
    log_warn "DATABASE_PASSWORD not set in env file — Terraform may prompt for db_password"
  fi

  log_step "terraform init (backend: s3://${TF_STATE_BUCKET}/${TF_STATE_KEY})"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: terraform init"
  else
    terraform -chdir="${TF_DIR}" init \
      -backend-config="bucket=${TF_STATE_BUCKET}" \
      -backend-config="key=${TF_STATE_KEY}" \
      -backend-config="region=${REGION}" \
      -backend-config="dynamodb_table=${TF_LOCKS_TABLE}" \
      -backend-config="encrypt=true" \
      -reconfigure \
      -input=false
    log_ok "terraform init complete"
  fi

  log_step "terraform plan"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: terraform plan -var-file=${TFVARS_FILE}"
  else
    terraform -chdir="${TF_DIR}" plan \
      -var-file="${TFVARS_FILE}" \
      -out="${TF_DIR}/.tfplan-${REGION}" \
      -input=false
    log_ok "terraform plan complete — review above before proceeding"
  fi

  log_step "terraform apply"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: terraform apply .tfplan-${REGION}"
  else
    terraform -chdir="${TF_DIR}" apply \
      -input=false \
      -auto-approve \
      "${TF_DIR}/.tfplan-${REGION}"
    log_ok "terraform apply complete"

    # Clean up plan file
    rm -f "${TF_DIR}/.tfplan-${REGION}"
  fi
}

# =============================================================================
# STEP 3: Configure kubeconfig from EKS
# =============================================================================

configure_kubeconfig() {
  log_section "Step 3: Configuring kubectl (EKS)"

  if $SKIP_TERRAFORM && $SKIP_HELM; then
    log_warn "Skipping kubeconfig (both terraform and helm are skipped)"
    return 0
  fi

  local cluster_name="forgepay-staging"

  log_step "aws eks update-kubeconfig --region ${REGION} --name ${cluster_name}"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would configure kubeconfig for cluster: ${cluster_name}"
  else
    aws eks update-kubeconfig \
      --region "${REGION}" \
      --name "${cluster_name}" \
      --alias "forgepay-staging-${REGION}"
    log_ok "kubeconfig updated for cluster: ${cluster_name}"

    # Verify connectivity
    if kubectl cluster-info &>/dev/null; then
      log_ok "Kubernetes cluster reachable"
    else
      die "Cannot reach Kubernetes cluster after kubeconfig update"
    fi
  fi
}

# =============================================================================
# STEP 4: Create namespace and load secrets
# =============================================================================

create_namespace_and_secrets() {
  log_section "Step 4: Namespace and Kubernetes Secrets"

  if $SKIP_HELM; then
    log_warn "--skip-helm set: skipping namespace and secrets"
    return 0
  fi

  # Create namespace
  log_step "Creating namespace: ${NAMESPACE}"
  if $DRY_RUN; then
    log_info "[DRY RUN] Would create namespace: ${NAMESPACE}"
  else
    kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
    log_ok "Namespace ready: ${NAMESPACE}"
  fi

  # Load secrets from .env.staging into Kubernetes
  if [[ ! -f "${ENV_FILE}" ]]; then
    log_warn ".env.staging not found — skipping Kubernetes secret creation"
    log_warn "Ensure secrets are pre-created (see SECRETS_SETUP.md)"
    return 0
  fi

  log_step "Loading secrets from ${ENV_FILE} into Kubernetes"

  # Read TF outputs for substitution
  local rds_endpoint="" redis_endpoint=""
  if ! $SKIP_TERRAFORM && ! $DRY_RUN; then
    rds_endpoint=$(terraform -chdir="${TF_DIR}" output -raw rds_endpoint 2>/dev/null || echo "")
    redis_endpoint=$(terraform -chdir="${TF_DIR}" output -raw redis_endpoint 2>/dev/null || echo "")
    log_step "RDS endpoint: ${rds_endpoint:-<not available>}"
    log_step "Redis endpoint: ${redis_endpoint:-<not available>}"
  fi

  # Create a processed env file with TF outputs substituted
  local processed_env
  processed_env=$(mktemp /tmp/forgepay-env-XXXXXX)
  trap 'rm -f "${processed_env}"' EXIT

  sed \
    -e "s|__TF_OUTPUT_rds_endpoint|${rds_endpoint}|g" \
    -e "s|__TF_OUTPUT_redis_endpoint|${redis_endpoint}|g" \
    "${ENV_FILE}" \
    | grep -v '^\s*#' \
    | grep -v '^\s*$' \
    > "${processed_env}"

  if $DRY_RUN; then
    log_info "[DRY RUN] Would create Kubernetes secrets from ${ENV_FILE}"
  else
    # Create a single generic secret containing all env vars
    # Services reference individual keys via secretKeyRef in their deployments
    kubectl create secret generic forgepay-staging-env \
      --namespace "${NAMESPACE}" \
      --from-env-file="${processed_env}" \
      --dry-run=client -o yaml \
      | kubectl apply -f -
    log_ok "Kubernetes secret 'forgepay-staging-env' created/updated"

    # Create per-service secrets for services that expect named secrets
    # (maps to the existingSecret references in values.yaml)
    kubectl create secret generic forgepay-db-credentials \
      --namespace "${NAMESPACE}" \
      --from-literal=postgres-password="$(grep '^DATABASE_PASSWORD=' "${processed_env}" | cut -d= -f2-)" \
      --dry-run=client -o yaml \
      | kubectl apply -f -
    log_ok "Kubernetes secret 'forgepay-db-credentials' created/updated"
  fi
}

# =============================================================================
# STEP 5: Helm install/upgrade
# =============================================================================

run_helm_deploy() {
  log_section "Step 5: Helm Deploy — forgepay-stack"

  if $SKIP_HELM; then
    log_warn "--skip-helm set: skipping Helm deploy"
    return 0
  fi

  # Read TF outputs for Helm value substitution
  local rds_endpoint="" redis_endpoint=""
  if ! $SKIP_TERRAFORM && ! $DRY_RUN; then
    rds_endpoint=$(terraform -chdir="${TF_DIR}" output -raw rds_endpoint 2>/dev/null || echo "")
    redis_endpoint=$(terraform -chdir="${TF_DIR}" output -raw redis_endpoint 2>/dev/null || echo "")
  fi

  # Create a temporary Helm values file with TF outputs substituted
  local processed_values
  processed_values=$(mktemp /tmp/forgepay-helm-values-XXXXXX.yaml)
  trap 'rm -f "${processed_values}"' EXIT

  sed \
    -e "s|__TF_OUTPUT_rds_endpoint|${rds_endpoint}|g" \
    -e "s|__TF_OUTPUT_redis_endpoint|${redis_endpoint}|g" \
    "${HELM_VALUES_FILE}" \
    > "${processed_values}"

  # Get AWS account ID for ECR image registry
  local aws_account_id=""
  if ! $DRY_RUN; then
    aws_account_id=$(aws sts get-caller-identity --region "${REGION}" --query 'Account' --output text 2>/dev/null || echo "")
    # Substitute ACCOUNT_ID placeholder in processed values
    if [[ -n "${aws_account_id}" ]]; then
      sed -i "s|ACCOUNT_ID|${aws_account_id}|g" "${processed_values}"
    fi
  fi

  log_step "helm upgrade --install forgepay-stack"
  log_step "  Chart: ${HELM_CHART_DIR}"
  log_step "  Base values: ${HELM_CHART_DIR}/values.yaml"
  log_step "  Region overrides: ${HELM_VALUES_FILE}"
  log_step "  Image tag: ${IMAGE_TAG}"
  log_step "  Namespace: ${NAMESPACE}"

  local helm_cmd=(
    helm upgrade --install forgepay-stack
    "${HELM_CHART_DIR}"
    --namespace "${NAMESPACE}"
    --values "${HELM_CHART_DIR}/values.yaml"
    --values "${processed_values}"
    --set "global.imageTag=${IMAGE_TAG}"
    --timeout "${HELM_TIMEOUT}"
    --wait
    --history-max 5
    --atomic
  )

  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: ${helm_cmd[*]}"
  else
    if "${helm_cmd[@]}"; then
      log_ok "Helm deploy complete"
    else
      die "Helm deploy failed. Run: helm history forgepay-stack -n ${NAMESPACE} to see previous releases."
    fi
  fi
}

# =============================================================================
# STEP 6: Wait for all pods to be ready
# =============================================================================

wait_for_pods() {
  log_section "Step 6: Waiting for Pods to be Ready"

  if $SKIP_HELM || $DRY_RUN; then
    log_warn "Skipping pod readiness wait (helm skipped or dry-run)"
    return 0
  fi

  log_step "Waiting up to ${POD_READY_TIMEOUT}s for all pods in ${NAMESPACE}..."

  local start_time elapsed pods_ready
  start_time=$(date +%s)
  pods_ready=false

  while true; do
    elapsed=$(( $(date +%s) - start_time ))
    if [[ ${elapsed} -ge ${POD_READY_TIMEOUT} ]]; then
      log_error "Timeout after ${POD_READY_TIMEOUT}s waiting for pods"
      kubectl get pods -n "${NAMESPACE}" || true
      die "Pods did not become ready in time. Check: kubectl describe pods -n ${NAMESPACE}"
    fi

    # Count total pods vs ready pods
    local total ready
    total=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    ready=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null \
      | grep -c "Running\|Completed" || true)

    local not_ready
    not_ready=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null \
      | grep -v "Running\|Completed\|Terminating" | wc -l | tr -d ' ')

    log_step "[${elapsed}s] Pods: ${ready}/${total} ready (${not_ready} not yet ready)"

    if [[ "${not_ready}" -eq 0 && "${total}" -gt 0 ]]; then
      pods_ready=true
      break
    fi

    sleep 10
  done

  if $pods_ready; then
    log_ok "All ${total} pods are ready"
    kubectl get pods -n "${NAMESPACE}"
  fi
}

# =============================================================================
# STEP 7: Health checks
# =============================================================================

run_health_checks() {
  log_section "Step 7: Service Health Checks"

  if $DRY_RUN; then
    log_info "[DRY RUN] Skipping health checks"
    return 0
  fi

  local failures=0

  # Health check via kubectl port-forward for in-cluster services
  # We use kubectl exec to curl from inside the cluster to avoid needing ingress/DNS
  declare -A services_ports=(
    ["payment-engine"]="80"
    ["unified-router"]="3000"
    ["mor-layer"]="8000"
    ["billing-engine"]="8080"
    ["stablecoin-gateway"]="3001"
    ["crypto-gateway"]="3002"
    ["yield-engine"]="3007"
    ["rwa-registry"]="3008"
    ["enterprise-treasury"]="3012"
    ["agent-identity"]="3010"
    ["agent-negotiation"]="3011"
    ["agent-decision-framework"]="3013"
    ["agent-credit-lines"]="3016"
    ["compliance-monitor"]="8001"
    ["liquidity-forecaster"]="8002"
    ["bank-connectivity"]="3003"
    ["bank-whitelabel"]="3015"
    ["accounts-service"]="3020"
  )

  declare -A health_paths=(
    ["payment-engine"]="/health"
    ["unified-router"]="/healthz"
    ["mor-layer"]="/health"
    ["billing-engine"]="/1.0/healthcheck"
    ["stablecoin-gateway"]="/healthz"
    ["crypto-gateway"]="/healthz"
    ["yield-engine"]="/healthz"
    ["rwa-registry"]="/healthz"
    ["enterprise-treasury"]="/healthz"
    ["agent-identity"]="/healthz"
    ["agent-negotiation"]="/healthz"
    ["agent-decision-framework"]="/healthz"
    ["agent-credit-lines"]="/healthz"
    ["compliance-monitor"]="/health"
    ["liquidity-forecaster"]="/health"
    ["bank-connectivity"]="/healthz"
    ["bank-whitelabel"]="/healthz"
    ["accounts-service"]="/healthz"
  )

  # Find a utility pod to run curl from inside the cluster
  local curl_pod
  curl_pod=$(kubectl get pod -n "${NAMESPACE}" -l "app=unified-router" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

  for service in "${!services_ports[@]}"; do
    local port="${services_ports[$service]}"
    local path="${health_paths[$service]}"
    local svc_url="http://${service}.${NAMESPACE}.svc.cluster.local:${port}${path}"

    log_step "Health check: ${service} (${svc_url})"

    # Check if deployment exists at all
    if ! kubectl get deployment "${service}" -n "${NAMESPACE}" &>/dev/null; then
      log_warn "  Deployment not found: ${service} (may be disabled in this region)"
      continue
    fi

    if [[ -n "${curl_pod}" ]]; then
      # Exec into a running pod to perform the health check inside the cluster network
      local http_code
      http_code=$(kubectl exec "${curl_pod}" -n "${NAMESPACE}" -- \
        curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout 5 --max-time 15 \
        "${svc_url}" 2>/dev/null) || http_code="000"

      if [[ "${http_code}" == "200" || "${http_code}" == "204" ]]; then
        log_ok "  ${service}: HTTP ${http_code}"
      else
        log_error "  ${service}: HTTP ${http_code} (expected 200)"
        (( failures++ )) || true
      fi
    else
      log_warn "  No curl pod available — using kubectl rollout status instead"
      if kubectl rollout status deployment/"${service}" \
          -n "${NAMESPACE}" --timeout=30s &>/dev/null; then
        log_ok "  ${service}: rollout OK"
      else
        log_error "  ${service}: rollout not healthy"
        (( failures++ )) || true
      fi
    fi
  done

  if [[ ${failures} -gt 0 ]]; then
    log_error "${failures} health check(s) failed"
    return 1
  fi

  log_ok "All service health checks passed"
}

# =============================================================================
# STEP 8: Run smoke tests
# =============================================================================

run_smoke_tests() {
  log_section "Step 8: Smoke Tests"

  if $SKIP_SMOKE_TESTS; then
    log_warn "--skip-smoke-tests set: skipping smoke tests"
    return 0
  fi

  local smoke_script="${SCRIPT_DIR}/smoke-tests.sh"
  if [[ ! -f "${smoke_script}" ]]; then
    log_warn "smoke-tests.sh not found at ${smoke_script}"
    return 0
  fi

  local api_base_url="https://api.${BASE_DOMAIN}"
  log_step "Running smoke tests against: ${api_base_url}"

  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: ${smoke_script} --base-url ${api_base_url}"
    return 0
  fi

  if SMOKE_BASE_URL="${api_base_url}" bash "${smoke_script}"; then
    log_ok "Smoke tests passed"
  else
    log_warn "Smoke tests reported failures — review output above"
    return 1
  fi
}

# =============================================================================
# STEP 9: Print summary
# =============================================================================

print_summary() {
  local duration=$1
  local duration_min=$(( duration / 60 ))
  local duration_sec=$(( duration % 60 ))

  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${GREEN}║  ForgePay Staging Deploy COMPLETE                            ║${RESET}"
  echo -e "${BOLD}${GREEN}║  Duration : ${duration_min}m${duration_sec}s$(printf '%*s' $((44 - ${#duration_min} - ${#duration_sec})) '')║${RESET}"
  echo -e "${BOLD}${GREEN}║  Region   : ${REGION}$(printf '%*s' $((48 - ${#REGION})) '')║${RESET}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "${BOLD}Service URLs:${RESET}"
  echo -e "  Payment API  : https://api.${BASE_DOMAIN}"
  echo -e "  Webhooks     : https://hooks.${BASE_DOMAIN}"
  echo -e "  Checkout     : https://checkout.${BASE_DOMAIN}"
  echo -e "  Dashboard    : https://dashboard.${BASE_DOMAIN}"
  echo ""
  echo -e "${BOLD}Useful commands:${RESET}"
  echo -e "  kubectl get pods -n ${NAMESPACE}"
  echo -e "  kubectl logs -n ${NAMESPACE} deployment/payment-engine -f"
  echo -e "  helm history forgepay-stack -n ${NAMESPACE}"
  echo -e "  ${SCRIPT_DIR}/teardown-staging.sh ${REGION}   # when done testing"
  echo ""
}

# =============================================================================
# MAIN
# =============================================================================

main() {
  local start_time
  start_time=$(date +%s)

  print_banner
  check_prerequisites
  run_terraform
  configure_kubeconfig
  create_namespace_and_secrets
  run_helm_deploy
  wait_for_pods

  local health_exit=0
  run_health_checks || health_exit=$?

  local smoke_exit=0
  run_smoke_tests || smoke_exit=$?

  local end_time elapsed
  end_time=$(date +%s)
  elapsed=$(( end_time - start_time ))

  if [[ ${health_exit} -ne 0 || ${smoke_exit} -ne 0 ]]; then
    log_warn "Deploy complete but some checks failed. Review output above."
    print_summary "${elapsed}"
    exit 1
  fi

  print_summary "${elapsed}"
}

main "$@"
