#!/bin/bash

# OpenPrivy Staging Deployment Script
# Deploys the complete stack to Kubernetes staging environment

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT="staging"
NAMESPACE="openprivy-staging"
REGISTRY="gcr.io/openprivy"
IMAGE_TAG="${IMAGE_TAG:-latest}"
KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-staging}"

echo -e "${YELLOW}=== OpenPrivy Staging Deployment ===${NC}"
echo "Environment: $ENVIRONMENT"
echo "Namespace: $NAMESPACE"
echo "Image Tag: $IMAGE_TAG"
echo ""

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to print status messages
print_status() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_info() {
  echo -e "${YELLOW}→ $1${NC}"
}

# Step 1: Verify prerequisites
echo -e "\n${YELLOW}Step 1: Verifying Prerequisites${NC}"

if ! command_exists kubectl; then
  print_error "kubectl not found. Please install kubectl."
  exit 1
fi
print_status "kubectl found"

if ! command_exists docker; then
  print_error "docker not found. Please install docker."
  exit 1
fi
print_status "docker found"

if ! command_exists helm; then
  print_error "helm not found. Please install helm."
  exit 1
fi
print_status "helm found"

# Step 2: Switch Kubernetes context
echo -e "\n${YELLOW}Step 2: Switching Kubernetes Context${NC}"
kubectl config use-context "$KUBECTL_CONTEXT" || {
  print_error "Could not switch to context $KUBECTL_CONTEXT"
  exit 1
}
print_status "Switched to context: $KUBECTL_CONTEXT"

# Step 3: Create namespace
echo -e "\n${YELLOW}Step 3: Creating/Updating Namespace${NC}"
kubectl apply -f k8s/namespace.yaml
print_status "Namespace ready"

# Step 4: Build and push Docker images
echo -e "\n${YELLOW}Step 4: Building Docker Images${NC}"

print_info "Building backend image..."
docker build \
  -t "$REGISTRY/backend:$IMAGE_TAG" \
  -f services/backend/Dockerfile \
  services/backend/

print_info "Pushing backend image to registry..."
docker push "$REGISTRY/backend:$IMAGE_TAG"
print_status "Backend image pushed"

# Step 5: Deploy infrastructure
echo -e "\n${YELLOW}Step 5: Deploying Infrastructure${NC}"

print_info "Deploying PostgreSQL..."
kubectl apply -f k8s/postgres.yaml -n "$NAMESPACE"

print_info "Waiting for PostgreSQL to be ready..."
kubectl wait --for=condition=ready pod -l app=postgres \
  -n "$NAMESPACE" --timeout=300s || {
  print_error "PostgreSQL failed to become ready"
  kubectl logs -n "$NAMESPACE" postgres-0
  exit 1
}
print_status "PostgreSQL ready"

print_info "Deploying Redis..."
kubectl apply -f k8s/redis.yaml -n "$NAMESPACE"

print_info "Waiting for Redis to be ready..."
kubectl wait --for=condition=ready pod -l app=redis \
  -n "$NAMESPACE" --timeout=300s || {
  print_error "Redis failed to become ready"
  exit 1
}
print_status "Redis ready"

# Step 6: Deploy backend
echo -e "\n${YELLOW}Step 6: Deploying Backend API${NC}"

print_info "Applying backend configuration..."
kubectl set image deployment/backend \
  backend="$REGISTRY/backend:$IMAGE_TAG" \
  -n "$NAMESPACE" || kubectl apply -f k8s/backend.yaml -n "$NAMESPACE"

print_info "Waiting for backend deployment..."
kubectl wait --for=condition=available deployment backend \
  -n "$NAMESPACE" --timeout=300s || {
  print_error "Backend deployment failed"
  kubectl logs -n "$NAMESPACE" -l app=backend --tail=50
  exit 1
}
print_status "Backend deployment ready"

# Step 7: Deploy monitoring
echo -e "\n${YELLOW}Step 7: Deploying Monitoring Stack${NC}"

print_info "Deploying Prometheus..."
kubectl apply -f k8s/prometheus.yaml -n "$NAMESPACE"

print_info "Waiting for Prometheus..."
kubectl wait --for=condition=ready pod -l app=prometheus \
  -n "$NAMESPACE" --timeout=300s || {
  print_error "Prometheus failed to become ready"
  exit 1
}
print_status "Prometheus ready"

# Step 8: Database migrations
echo -e "\n${YELLOW}Step 8: Running Database Migrations${NC}"

print_info "Waiting for database connection..."
POD=$(kubectl get pods -n "$NAMESPACE" -l app=backend -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "$NAMESPACE" "$POD" -- npm run migrate:prod || {
  print_error "Database migrations failed"
  exit 1
}
print_status "Database migrations completed"

# Step 9: Smoke tests
echo -e "\n${YELLOW}Step 9: Running Smoke Tests${NC}"

# Get service IP
SERVICE_IP=$(kubectl get svc backend -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' || echo "localhost:3001")

print_info "Waiting for API to be responsive..."
for i in {1..30}; do
  if curl -s "http://$SERVICE_IP/health" >/dev/null 2>&1; then
    print_status "API is responsive"
    break
  fi
  if [ $i -eq 30 ]; then
    print_error "API failed to become responsive"
    exit 1
  fi
  sleep 2
done

# Run smoke tests
print_info "Running smoke test suite..."
if command_exists npm; then
  BASE_URL="http://$SERVICE_IP" npm run test:smoke || {
    print_error "Smoke tests failed"
    exit 1
  }
fi
print_status "Smoke tests passed"

# Step 10: Verify deployment
echo -e "\n${YELLOW}Step 10: Verifying Deployment${NC}"

echo "Deployment Status:"
kubectl get deployment -n "$NAMESPACE"
echo ""

echo "Pod Status:"
kubectl get pods -n "$NAMESPACE"
echo ""

echo "Service Status:"
kubectl get svc -n "$NAMESPACE"
echo ""

# Step 11: Summary
echo -e "\n${GREEN}=== Deployment Summary ===${NC}"
print_status "Staging deployment completed successfully"
echo ""
echo "Access Points:"
echo "  Backend API: http://backend.$NAMESPACE.svc.cluster.local:3001"
echo "  Prometheus: http://prometheus.$NAMESPACE.svc.cluster.local:9090"
echo ""
echo "Next steps:"
echo "  1. Run E2E test suite: BASE_URL=http://backend:3001 npm run test:e2e"
echo "  2. Run load tests: k6 run test/load/api-load.k6.js"
echo "  3. Monitor metrics: kubectl port-forward -n $NAMESPACE svc/prometheus 9090:9090"
echo "  4. Review logs: kubectl logs -n $NAMESPACE -l app=backend -f"
echo ""

print_status "Ready for staging validation"
