#!/usr/bin/env bash
# =============================================================================
# ForgePay Production Deployment Script
# =============================================================================
# Usage:
#   ./deploy.sh [--dry-run] [--skip-backup] [--skip-migrations] [--namespace NS]
#
# Prerequisites:
#   - kubectl, helm, aws CLI installed and on PATH
#   - KUBECONFIG pointing at the production cluster
#   - Vault/AWS Secrets Manager accessible from this machine
#   - PostgreSQL client tools (pg_isready, pg_dump) installed
#   - redis-cli installed
#
# Required environment variables:
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#   REDIS_HOST, REDIS_PORT
#   SLACK_WEBHOOK_URL (optional — for rollback alerts)
#
# Exit codes:
#   0  success
#   1  pre-flight check failed
#   2  migration failed
#   3  deployment failed
#   4  post-deployment health check failed

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

NAMESPACE="${NAMESPACE:-forgepay}"
HELM_TIMEOUT="${HELM_TIMEOUT:-5m}"
HEALTH_CHECK_BASE_URL="${HEALTH_CHECK_BASE_URL:-https://api.forgepay.io}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/forgepay-backups}"
DRY_RUN=false
SKIP_BACKUP=false
SKIP_MIGRATIONS=false
ROLLBACK_TRIGGERED=false

# Deployment wave order (dependency-ordered)
# Wave 1: No dependencies
WAVE1_SERVICES=(
  "accounts-service"
  "agent-identity"
)

# Wave 2: Depends on Wave 1
WAVE2_SERVICES=(
  "bank-connectivity"
  "rwa-registry"
)

# Wave 3: Depends on Wave 2
WAVE3_SERVICES=(
  "yield-engine"
  "crypto-gateway"
  "stablecoin-gateway"
)

# Wave 4: Depends on Wave 3
WAVE4_SERVICES=(
  "mor-layer"
  "unified-router"
)

# Wave 5: Depends on Wave 4
WAVE5_SERVICES=(
  "enterprise-treasury"
  "agent-credit-lines"
)

# Wave 6: Depends on Wave 5
WAVE6_SERVICES=(
  "compliance-monitor"
  "institutional-reporting"
)

# Required Kubernetes secrets that must exist before deployment
REQUIRED_K8S_SECRETS=(
  "forgepay-unified-router-secrets"
  "forgepay-accounts-service-secrets"
  "forgepay-agent-identity-secrets"
  "forgepay-crypto-gateway-secrets"
  "forgepay-stablecoin-gateway-secrets"
  "forgepay-mor-layer-secrets"
  "forgepay-yield-engine-secrets"
  "forgepay-enterprise-treasury-secrets"
  "forgepay-compliance-monitor-secrets"
)

# Required secret keys to verify across secrets
REQUIRED_SECRET_KEYS=(
  "JWT_SECRET"
  "POSTGRES_PASSWORD"
  "INTERNAL_WEBHOOK_SECRET"
  "HYPERSWITCH_WEBHOOK_SECRET"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# =============================================================================
# Logging helpers
# =============================================================================

log_info()    { echo -e "${BLUE}[INFO]${RESET}  $(date -u +%H:%M:%S) $*"; }
log_ok()      { echo -e "${GREEN}[OK]${RESET}    $(date -u +%H:%M:%S) $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $(date -u +%H:%M:%S) $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $(date -u +%H:%M:%S) $*" >&2; }
log_section() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}"; \
                echo -e "${BOLD}${CYAN}  $*${RESET}"; \
                echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}\n"; }

# =============================================================================
# Argument parsing
# =============================================================================

for arg in "$@"; do
  case "$arg" in
    --dry-run)          DRY_RUN=true; log_warn "DRY RUN MODE — no changes will be applied" ;;
    --skip-backup)      SKIP_BACKUP=true; log_warn "Skipping pre-migration backup" ;;
    --skip-migrations)  SKIP_MIGRATIONS=true; log_warn "Skipping database migrations" ;;
    --namespace=*)      NAMESPACE="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 [--dry-run] [--skip-backup] [--skip-migrations] [--namespace=NAMESPACE]"
      exit 0 ;;
    *)
      log_error "Unknown argument: $arg"
      exit 1 ;;
  esac
done

# =============================================================================
# Notification helper
# =============================================================================

notify_slack() {
  local message="$1"
  local color="${2:-#36a64f}"  # green by default; use #ff0000 for errors

  if [[ -z "${SLACK_WEBHOOK_URL:-}" ]]; then
    log_warn "SLACK_WEBHOOK_URL not set — skipping Slack notification"
    return 0
  fi

  curl -s -X POST "${SLACK_WEBHOOK_URL}" \
    -H 'Content-type: application/json' \
    --data "{\"attachments\":[{\"color\":\"${color}\",\"text\":\"${message}\"}]}" \
    > /dev/null 2>&1 || log_warn "Slack notification failed"
}

# =============================================================================
# Rollback helper
# =============================================================================

rollback_service() {
  local service="$1"

  ROLLBACK_TRIGGERED=true
  log_error "ROLLBACK TRIGGERED for ${service}"
  notify_slack ":rotating_light: ROLLBACK TRIGGERED for *${service}* in namespace \`${NAMESPACE}\`" "#ff0000"

  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: helm rollback ${service} 0 -n ${NAMESPACE}"
    return 0
  fi

  # helm rollback 0 rolls back to the previous release
  if helm rollback "${service}" 0 \
    --namespace "${NAMESPACE}" \
    --wait \
    --timeout "${HELM_TIMEOUT}"; then
    log_ok "Rolled back ${service} successfully"
    notify_slack ":white_check_mark: Rollback of *${service}* succeeded" "#36a64f"
  else
    log_error "Rollback of ${service} ALSO FAILED — manual intervention required"
    notify_slack ":sos: Rollback of *${service}* FAILED — manual intervention required" "#ff0000"
  fi
}

rollback_all_deployed() {
  local -n deployed_ref=$1
  log_error "Rolling back all services deployed in this run..."
  for svc in "${deployed_ref[@]}"; do
    rollback_service "${svc}" || true
  done
}

# =============================================================================
# SECTION 1: Pre-Flight Checks
# =============================================================================

preflight_checks() {
  log_section "Pre-Flight Checks"
  local failures=0

  # ── Tool availability ──────────────────────────────────────────────────────
  log_info "Checking required CLI tools..."
  for tool in kubectl helm aws pg_isready pg_dump redis-cli curl; do
    if command -v "${tool}" &> /dev/null; then
      log_ok "${tool} found: $(command -v "${tool}")"
    else
      log_error "${tool} is not installed or not on PATH"
      (( failures++ )) || true
    fi
  done

  # ── Cluster connectivity ───────────────────────────────────────────────────
  log_info "Checking Kubernetes cluster connectivity..."
  if $DRY_RUN; then
    log_info "[DRY RUN] Skipping kubectl cluster-info"
  elif kubectl cluster-info --request-timeout=10s &> /dev/null; then
    log_ok "Kubernetes cluster reachable"
    kubectl cluster-info 2>/dev/null | grep "control plane" || true
  else
    log_error "Cannot reach Kubernetes cluster — check KUBECONFIG"
    (( failures++ )) || true
  fi

  # ── Namespace exists ───────────────────────────────────────────────────────
  log_info "Checking namespace: ${NAMESPACE}..."
  if $DRY_RUN; then
    log_info "[DRY RUN] Skipping namespace check"
  elif kubectl get namespace "${NAMESPACE}" &> /dev/null; then
    log_ok "Namespace '${NAMESPACE}' exists"
  else
    log_error "Namespace '${NAMESPACE}' does not exist — run: kubectl create namespace ${NAMESPACE}"
    (( failures++ )) || true
  fi

  # ── Required Kubernetes secrets ────────────────────────────────────────────
  log_info "Verifying required Kubernetes secrets..."
  if ! $DRY_RUN; then
    for secret in "${REQUIRED_K8S_SECRETS[@]}"; do
      if kubectl get secret "${secret}" -n "${NAMESPACE}" &> /dev/null; then
        log_ok "Secret '${secret}' exists"
      else
        log_error "Required secret '${secret}' not found in namespace '${NAMESPACE}'"
        (( failures++ )) || true
      fi
    done

    # Check critical secret keys in the primary secrets store
    for key in "${REQUIRED_SECRET_KEYS[@]}"; do
      if kubectl get secret "forgepay-unified-router-secrets" -n "${NAMESPACE}" \
          -o jsonpath="{.data.${key}}" 2>/dev/null | base64 -d &> /dev/null; then
        log_ok "Secret key '${key}' is populated"
      else
        log_warn "Secret key '${key}' not found or empty in forgepay-unified-router-secrets"
      fi
    done
  else
    log_info "[DRY RUN] Skipping secret verification"
  fi

  # ── PostgreSQL reachability ────────────────────────────────────────────────
  log_info "Checking PostgreSQL connectivity..."
  local pg_host="${PGHOST:-localhost}"
  local pg_port="${PGPORT:-5432}"
  local pg_user="${PGUSER:-forgepay}"
  local pg_db="${PGDATABASE:-forgepay_prod}"

  if $DRY_RUN; then
    log_info "[DRY RUN] Would check: pg_isready -h ${pg_host} -p ${pg_port}"
  elif pg_isready -h "${pg_host}" -p "${pg_port}" -U "${pg_user}" -d "${pg_db}" -t 10; then
    log_ok "PostgreSQL is reachable at ${pg_host}:${pg_port}"
  else
    log_error "PostgreSQL is not reachable at ${pg_host}:${pg_port}"
    (( failures++ )) || true
  fi

  # ── Redis reachability ─────────────────────────────────────────────────────
  log_info "Checking Redis connectivity..."
  local redis_host="${REDIS_HOST:-localhost}"
  local redis_port="${REDIS_PORT:-6379}"

  if $DRY_RUN; then
    log_info "[DRY RUN] Would check: redis-cli -h ${redis_host} -p ${redis_port} ping"
  elif redis-cli -h "${redis_host}" -p "${redis_port}" ping | grep -q "PONG"; then
    log_ok "Redis is reachable at ${redis_host}:${redis_port}"
  else
    log_error "Redis is not reachable at ${redis_host}:${redis_port}"
    (( failures++ )) || true
  fi

  # ── Helm repo up-to-date ───────────────────────────────────────────────────
  log_info "Updating Helm repos..."
  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: helm repo update"
  else
    helm repo update 2>/dev/null || log_warn "Helm repo update failed (may have no repos configured)"
  fi

  # ── Summary ───────────────────────────────────────────────────────────────
  if [[ ${failures} -gt 0 ]]; then
    log_error "Pre-flight checks failed with ${failures} error(s). Aborting deployment."
    exit 1
  fi

  log_ok "All pre-flight checks passed"
}

# =============================================================================
# SECTION 2: Database Backup
# =============================================================================

run_database_backup() {
  log_section "Database Backup"

  if $SKIP_BACKUP; then
    log_warn "Skipping backup (--skip-backup flag set)"
    return 0
  fi

  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="${BACKUP_DIR}/forgepay_prod_${timestamp}.sql"

  mkdir -p "${BACKUP_DIR}"

  local pg_host="${PGHOST:-localhost}"
  local pg_port="${PGPORT:-5432}"
  local pg_user="${PGUSER:-forgepay}"
  local pg_db="${PGDATABASE:-forgepay_prod}"

  log_info "Creating pre-migration backup: ${backup_file}"

  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: pg_dump ${pg_db} > ${backup_file}"
    log_ok "[DRY RUN] Backup skipped"
    return 0
  fi

  if pg_dump \
    -h "${pg_host}" \
    -p "${pg_port}" \
    -U "${pg_user}" \
    -d "${pg_db}" \
    --format=plain \
    --no-password \
    --verbose \
    > "${backup_file}" 2>&1; then
    local size
    size=$(du -sh "${backup_file}" | cut -f1)
    log_ok "Backup created: ${backup_file} (${size})"
  else
    log_error "Database backup FAILED. Aborting — refusing to deploy without backup."
    log_error "To override: re-run with --skip-backup (NOT RECOMMENDED FOR PRODUCTION)"
    exit 2
  fi

  # Optionally upload to S3
  if command -v aws &> /dev/null && [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
    log_info "Uploading backup to S3: s3://${BACKUP_S3_BUCKET}/backups/forgepay_prod_${timestamp}.sql"
    if aws s3 cp "${backup_file}" "s3://${BACKUP_S3_BUCKET}/backups/forgepay_prod_${timestamp}.sql" \
        --sse AES256 \
        --storage-class STANDARD_IA; then
      log_ok "Backup uploaded to S3"
    else
      log_warn "S3 upload failed — local backup retained at ${backup_file}"
    fi
  fi
}

# =============================================================================
# SECTION 3: Database Migrations
# =============================================================================

run_migrations() {
  log_section "Database Migrations"

  if $SKIP_MIGRATIONS; then
    log_warn "Skipping migrations (--skip-migrations flag set)"
    return 0
  fi

  local pg_host="${PGHOST:-localhost}"
  local pg_port="${PGPORT:-5432}"
  local pg_user="${PGUSER:-forgepay}"
  local pg_db="${PGDATABASE:-forgepay_prod}"

  # Apply all SQL migrations in order
  local migrations_dir
  migrations_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/k8s/migrations"

  if [[ ! -d "${migrations_dir}" ]]; then
    log_warn "Migrations directory not found: ${migrations_dir}"
    log_warn "Skipping SQL migrations — run service migrations via kubectl jobs below"
  else
    log_info "Applying SQL migrations from: ${migrations_dir}"
    for migration_file in "${migrations_dir}"/*.sql; do
      [[ -f "${migration_file}" ]] || continue
      local migration_name
      migration_name=$(basename "${migration_file}")
      log_info "Running migration: ${migration_name}"

      if $DRY_RUN; then
        log_info "[DRY RUN] Would apply: ${migration_file}"
        continue
      fi

      if PGPASSWORD="${PGPASSWORD:-}" psql \
          -h "${pg_host}" \
          -p "${pg_port}" \
          -U "${pg_user}" \
          -d "${pg_db}" \
          -f "${migration_file}" \
          --no-password \
          -v ON_ERROR_STOP=1; then
        log_ok "Applied migration: ${migration_name}"
      else
        log_error "Migration FAILED: ${migration_name}"
        log_error "Database is in an inconsistent state — check logs and restore from backup if needed"
        exit 2
      fi
    done
  fi

  # Run service-level migrations via kubectl jobs for services that manage their own schema
  local migration_services=(
    "agent-credit-lines"
    "chain-sync"
    "enterprise-treasury"
    "rwa-registry"
    "stablecoin-gateway"
    "crypto-gateway"
    "yield-engine"
  )

  for svc in "${migration_services[@]}"; do
    local job_name="migration-${svc}-$(date +%s)"
    log_info "Running migration job for ${svc}: ${job_name}"

    if $DRY_RUN; then
      log_info "[DRY RUN] Would create kubectl job for ${svc}"
      continue
    fi

    # Create a one-off migration job from the service's deployment template
    kubectl create job "${job_name}" \
      --from="deployment/${svc}" \
      -n "${NAMESPACE}" \
      --dry-run=client -o json \
      | jq '.spec.template.spec.containers[0].command = ["node", "dist/migrate.js"]
            | .spec.template.spec.restartPolicy = "Never"
            | .spec.backoffLimit = 0' \
      | kubectl apply -f - \
      --namespace "${NAMESPACE}" 2>/dev/null \
      || kubectl create job "${job_name}" \
           --namespace "${NAMESPACE}" \
           --image="forgepay/${svc}:latest" \
           -- node dist/migrate.js \
         2>/dev/null \
      || log_warn "Could not create migration job for ${svc} (service may not use migrations)"

    # Wait for migration job to complete
    if kubectl get job "${job_name}" -n "${NAMESPACE}" &> /dev/null; then
      log_info "Waiting for migration job ${job_name} to complete..."
      if kubectl wait job/"${job_name}" \
          --namespace "${NAMESPACE}" \
          --for=condition=complete \
          --timeout=5m; then
        log_ok "Migration job completed: ${svc}"
        # Clean up job
        kubectl delete job "${job_name}" -n "${NAMESPACE}" --ignore-not-found=true
      else
        log_error "Migration job TIMED OUT or FAILED: ${svc}"
        # Print job logs for debugging
        kubectl logs -l "job-name=${job_name}" -n "${NAMESPACE}" --tail=50 || true
        kubectl delete job "${job_name}" -n "${NAMESPACE}" --ignore-not-found=true
        exit 2
      fi
    fi
  done

  # Verify critical migration tables exist
  log_info "Verifying migration tables post-run..."
  local expected_tables=(
    "payment_events"
    "webhook_deliveries"
    "checkout_sessions"
    "invoices"
    "stablecoin_deposits"
    "rwa_assets"
    "yield_positions"
    "chain_events"
  )

  if ! $DRY_RUN; then
    for table in "${expected_tables[@]}"; do
      if PGPASSWORD="${PGPASSWORD:-}" psql \
          -h "${pg_host}" -p "${pg_port}" -U "${pg_user}" -d "${pg_db}" \
          -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='${table}';" \
          --no-password 2>/dev/null | grep -q "1"; then
        log_ok "Table exists: ${table}"
      else
        log_warn "Expected table not found: ${table} (may not be migrated yet)"
      fi
    done
  fi

  log_ok "Database migrations complete"
}

# =============================================================================
# SECTION 4: Deploy a single service
# =============================================================================

deploy_service() {
  local service="$1"
  local -n deployed_list=$2  # nameref to track deployed services for rollback
  local helm_chart_dir
  helm_chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/helm/${service}"

  log_info "Deploying ${service}..."

  if [[ ! -d "${helm_chart_dir}" ]]; then
    log_warn "No Helm chart found for ${service} at ${helm_chart_dir} — skipping"
    return 0
  fi

  local helm_cmd=(
    helm upgrade --install "${service}"
    "${helm_chart_dir}"
    --namespace "${NAMESPACE}"
    --atomic
    --timeout "${HELM_TIMEOUT}"
    --wait
    --history-max 5
    --set "image.tag=${IMAGE_TAG:-latest}"
  )

  # Apply production values override if it exists
  local prod_values="${helm_chart_dir}/values-production.yaml"
  if [[ -f "${prod_values}" ]]; then
    helm_cmd+=(--values "${prod_values}")
  fi

  if $DRY_RUN; then
    log_info "[DRY RUN] Would run: ${helm_cmd[*]}"
    deployed_list+=("${service}")
    return 0
  fi

  if "${helm_cmd[@]}"; then
    log_ok "Deployed: ${service}"
    deployed_list+=("${service}")
  else
    log_error "Deployment FAILED for ${service}"
    rollback_service "${service}"
    return 3
  fi

  # Verify rollout status
  log_info "Checking rollout status for ${service}..."
  if kubectl rollout status deployment/"${service}" \
      --namespace "${NAMESPACE}" \
      --timeout=3m; then
    log_ok "Rollout healthy: ${service}"
  else
    log_error "Rollout unhealthy for ${service}"
    rollback_service "${service}"
    return 3
  fi
}

# =============================================================================
# SECTION 5: Deploy all services in dependency order
# =============================================================================

deploy_all_services() {
  log_section "Service Deployment"

  local deployed_services=()

  # Helper: deploy a wave of services
  deploy_wave() {
    local wave_name="$1"
    shift
    local wave_services=("$@")

    log_info "Deploying Wave: ${wave_name} (${wave_services[*]})"

    for svc in "${wave_services[@]}"; do
      if ! deploy_service "${svc}" deployed_services; then
        log_error "Wave ${wave_name} failed on service: ${svc}"
        log_error "Rolling back all services deployed in this run..."
        rollback_all_deployed deployed_services
        exit 3
      fi
    done

    log_ok "Wave ${wave_name} complete"
    echo ""
  }

  deploy_wave "1 — Foundation (accounts-service, agent-identity)" "${WAVE1_SERVICES[@]}"
  deploy_wave "2 — Connectivity (bank-connectivity, rwa-registry)" "${WAVE2_SERVICES[@]}"
  deploy_wave "3 — Gateways (yield-engine, crypto-gateway, stablecoin-gateway)" "${WAVE3_SERVICES[@]}"
  deploy_wave "4 — Routing (mor-layer, unified-router)" "${WAVE4_SERVICES[@]}"
  deploy_wave "5 — Enterprise (enterprise-treasury, agent-credit-lines)" "${WAVE5_SERVICES[@]}"
  deploy_wave "6 — Compliance + Reporting (compliance-monitor, institutional-reporting)" "${WAVE6_SERVICES[@]}"

  log_ok "All deployment waves completed. Services deployed: ${deployed_services[*]}"
}

# =============================================================================
# SECTION 6: Post-Deployment Verification
# =============================================================================

run_health_checks() {
  log_section "Post-Deployment Health Checks"
  local failures=0

  # Service health endpoint map: service_name → path
  declare -A health_paths=(
    ["unified-router"]="/healthz"
    ["mor-layer"]="/health"
    ["stablecoin-gateway"]="/healthz"
    ["crypto-gateway"]="/healthz"
    ["accounts-service"]="/healthz"
    ["agent-identity"]="/healthz"
    ["agent-credit-lines"]="/healthz"
    ["bank-connectivity"]="/healthz"
    ["rwa-registry"]="/healthz"
    ["yield-engine"]="/healthz"
    ["enterprise-treasury"]="/healthz"
    ["compliance-monitor"]="/health"
    ["institutional-reporting"]="/health"
  )

  # For local cluster checks, use port-forwarding or service URLs
  # In production, use the external API gateway URL
  for service in "${!health_paths[@]}"; do
    local path="${health_paths[$service]}"
    local url="${HEALTH_CHECK_BASE_URL}/${service}${path}"
    # Alternative: directly hit the K8s service if inside cluster
    # local url="http://${service}.${NAMESPACE}.svc.cluster.local:8000${path}"

    log_info "Health check: ${service} → ${url}"

    if $DRY_RUN; then
      log_info "[DRY RUN] Would check: curl ${url}"
      continue
    fi

    local response
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      --connect-timeout 5 \
      --max-time 15 \
      "${url}" 2>/dev/null) || http_code="000"

    if [[ "${http_code}" == "200" ]]; then
      log_ok "${service}: HTTP ${http_code}"
    else
      log_error "${service}: HTTP ${http_code} (expected 200)"
      (( failures++ )) || true
    fi
  done

  # Prometheus scrape check
  log_info "Checking Prometheus targets..."
  local prometheus_url="${PROMETHEUS_URL:-http://prometheus.${NAMESPACE}.svc.cluster.local:9090}"

  if ! $DRY_RUN; then
    local targets_down
    targets_down=$(curl -s "${prometheus_url}/api/v1/targets" 2>/dev/null \
      | jq -r '.data.activeTargets[] | select(.health != "up") | .labels.job' 2>/dev/null \
      | wc -l) || targets_down="unknown"

    if [[ "${targets_down}" == "0" ]]; then
      log_ok "All Prometheus targets are UP"
    elif [[ "${targets_down}" == "unknown" ]]; then
      log_warn "Could not check Prometheus targets (Prometheus may not be accessible from here)"
    else
      log_warn "${targets_down} Prometheus target(s) are DOWN — check Grafana for details"
    fi
  fi

  if [[ ${failures} -gt 0 ]]; then
    log_error "${failures} health check(s) failed"
    return 4
  fi

  log_ok "All health checks passed"
}

run_smoke_tests() {
  log_section "Smoke Tests"

  local smoke_script
  smoke_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/smoke-tests.sh"

  if [[ -f "${smoke_script}" ]]; then
    log_info "Running smoke tests: ${smoke_script}"
    if $DRY_RUN; then
      log_info "[DRY RUN] Would run smoke tests"
    elif bash "${smoke_script}"; then
      log_ok "Smoke tests passed"
    else
      log_error "Smoke tests FAILED"
      return 4
    fi
  else
    log_warn "smoke-tests.sh not found at ${smoke_script} — skipping"
  fi
}

# =============================================================================
# MAIN
# =============================================================================

main() {
  local start_time
  start_time=$(date -u +%s)

  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${CYAN}║         ForgePay Production Deployment                   ║${RESET}"
  echo -e "${BOLD}${CYAN}║         $(date -u +'%Y-%m-%d %H:%M:%S UTC')                     ║${RESET}"
  echo -e "${BOLD}${CYAN}║         Namespace: ${NAMESPACE}$(printf '%*s' $((38 - ${#NAMESPACE})) '')║${RESET}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  if $DRY_RUN; then
    echo -e "${YELLOW}★ DRY RUN MODE — No changes will be applied ★${RESET}"
    echo ""
  fi

  notify_slack ":rocket: ForgePay deployment started in namespace \`${NAMESPACE}\` at $(date -u +'%Y-%m-%d %H:%M UTC')"

  # Run each phase — exit codes propagate via set -e
  preflight_checks
  run_database_backup
  run_migrations
  deploy_all_services

  local health_exit=0
  run_health_checks || health_exit=$?
  run_smoke_tests || health_exit=$?

  local end_time
  end_time=$(date -u +%s)
  local duration=$(( end_time - start_time ))
  local duration_min=$(( duration / 60 ))
  local duration_sec=$(( duration % 60 ))

  if [[ ${health_exit} -ne 0 ]]; then
    log_error "Post-deployment checks failed. Consider rolling back services manually."
    notify_slack ":warning: ForgePay deployment completed with health check failures (${duration_min}m${duration_sec}s). Manual review required." "#ff9900"
    exit ${health_exit}
  fi

  log_ok ""
  log_ok "══════════════════════════════════════════════════"
  log_ok "  Deployment SUCCESSFUL in ${duration_min}m${duration_sec}s"
  log_ok "══════════════════════════════════════════════════"

  notify_slack ":white_check_mark: ForgePay deployment *SUCCESSFUL* in ${duration_min}m${duration_sec}s — all health checks passed" "#36a64f"
}

main "$@"
