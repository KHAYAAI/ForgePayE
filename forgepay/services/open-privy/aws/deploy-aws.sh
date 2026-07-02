#!/bin/bash

# OpenPrivy AWS Deployment Script
# Deploys complete infrastructure on AWS including VPC, EKS, RDS, ElastiCache

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
CLUSTER_NAME="${CLUSTER_NAME:-openprivy-prod}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-default}"
ENVIRONMENT="${ENVIRONMENT:-production}"
DB_MASTER_PASSWORD="${DB_MASTER_PASSWORD:-$(openssl rand -base64 32)}"

# Stack names
VPC_STACK="${CLUSTER_NAME}-vpc-eks"
DB_STACK="${CLUSTER_NAME}-databases"

# Logging functions
log_info() { echo -e "${BLUE}ℹ $1${NC}"; }
log_success() { echo -e "${GREEN}✓ $1${NC}"; }
log_error() { echo -e "${RED}✗ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }

# Check prerequisites
check_prerequisites() {
  log_info "Checking prerequisites..."

  if ! command -v aws &> /dev/null; then
    log_error "AWS CLI not installed. Install from: https://aws.amazon.com/cli/"
    exit 1
  fi
  log_success "AWS CLI found"

  if ! command -v kubectl &> /dev/null; then
    log_error "kubectl not installed. Install from: https://kubernetes.io/docs/tasks/tools/"
    exit 1
  fi
  log_success "kubectl found"

  if ! command -v helm &> /dev/null; then
    log_error "Helm not installed. Install from: https://helm.sh/docs/intro/install/"
    exit 1
  fi
  log_success "Helm found"

  # Check AWS credentials
  if ! aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" &> /dev/null; then
    log_error "AWS credentials not configured or invalid"
    exit 1
  fi
  log_success "AWS credentials valid"
}

# Deploy VPC and EKS
deploy_vpc_eks() {
  log_info "Deploying VPC and EKS cluster..."

  aws cloudformation deploy \
    --template-file aws/cloudformation-vpc-eks.yaml \
    --stack-name "$VPC_STACK" \
    --parameter-overrides \
      ClusterName="$CLUSTER_NAME" \
      VpcCIDR="10.0.0.0/16" \
      PublicSubnet1CIDR="10.0.1.0/24" \
      PublicSubnet2CIDR="10.0.2.0/24" \
      PrivateSubnet1CIDR="10.0.11.0/24" \
      PrivateSubnet2CIDR="10.0.12.0/24" \
      NodeGroupMinSize="3" \
      NodeGroupMaxSize="10" \
      NodeInstanceType="t3.large" \
    --capabilities CAPABILITY_IAM \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"

  log_success "VPC and EKS cluster deployed"
}

# Get VPC and Subnet IDs
get_vpc_info() {
  log_info "Retrieving VPC and subnet information..."

  VPC_ID=$(aws cloudformation describe-stacks \
    --stack-name "$VPC_STACK" \
    --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE")

  PRIVATE_SUBNET_1=$(aws cloudformation describe-stacks \
    --stack-name "$VPC_STACK" \
    --query 'Stacks[0].Outputs[?OutputKey==`PrivateSubnet1`].OutputValue' \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE")

  PRIVATE_SUBNET_2=$(aws cloudformation describe-stacks \
    --stack-name "$VPC_STACK" \
    --query 'Stacks[0].Outputs[?OutputKey==`PrivateSubnet2`].OutputValue' \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE")

  log_success "VPC ID: $VPC_ID"
  log_success "Private Subnet 1: $PRIVATE_SUBNET_1"
  log_success "Private Subnet 2: $PRIVATE_SUBNET_2"
}

# Deploy RDS and ElastiCache
deploy_databases() {
  log_info "Deploying RDS PostgreSQL and ElastiCache Redis..."

  aws cloudformation deploy \
    --template-file aws/cloudformation-databases.yaml \
    --stack-name "$DB_STACK" \
    --parameter-overrides \
      ClusterName="$CLUSTER_NAME" \
      DBName="openprivy" \
      DBMasterUsername="admin" \
      DBMasterPassword="$DB_MASTER_PASSWORD" \
      DBInstanceClass="db.t3.medium" \
      RedisNodeType="cache.t3.micro" \
      VpcId="$VPC_ID" \
      PrivateSubnet1="$PRIVATE_SUBNET_1" \
      PrivateSubnet2="$PRIVATE_SUBNET_2" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"

  log_success "RDS and ElastiCache deployed"
}

# Get database endpoints
get_database_info() {
  log_info "Retrieving database information..."

  RDS_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$DB_STACK" \
    --query 'Stacks[0].Outputs[?OutputKey==`RDSEndpoint`].OutputValue' \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE")

  REDIS_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$DB_STACK" \
    --query 'Stacks[0].Outputs[?OutputKey==`RedisEndpoint`].OutputValue' \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE")

  log_success "RDS Endpoint: $RDS_ENDPOINT"
  log_success "Redis Endpoint: $REDIS_ENDPOINT"
}

# Configure kubectl
configure_kubectl() {
  log_info "Configuring kubectl..."

  aws eks update-kubeconfig \
    --name "$CLUSTER_NAME" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"

  log_success "kubectl configured for EKS cluster"

  # Verify cluster access
  if kubectl cluster-info &> /dev/null; then
    log_success "Successfully connected to EKS cluster"
  else
    log_error "Failed to connect to EKS cluster"
    exit 1
  fi
}

# Create namespaces
create_namespaces() {
  log_info "Creating Kubernetes namespaces..."

  kubectl create namespace openprivy --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f -

  log_success "Namespaces created"
}

# Create secrets
create_secrets() {
  log_info "Creating Kubernetes secrets..."

  # Database credentials
  kubectl create secret generic db-credentials \
    --from-literal=DATABASE_URL="postgresql://admin:${DB_MASTER_PASSWORD}@${RDS_ENDPOINT}:5432/openprivy" \
    --namespace openprivy \
    --dry-run=client -o yaml | kubectl apply -f -

  # Redis URL
  kubectl create secret generic redis-credentials \
    --from-literal=REDIS_URL="redis://${REDIS_ENDPOINT}:6379/0" \
    --namespace openprivy \
    --dry-run=client -o yaml | kubectl apply -f -

  # Generate JWT secret
  JWT_SECRET=$(openssl rand -base64 32)
  kubectl create secret generic app-secrets \
    --from-literal=JWT_SECRET="$JWT_SECRET" \
    --from-literal=ENCRYPTION_KEY="$(openssl rand -c 32)" \
    --namespace openprivy \
    --dry-run=client -o yaml | kubectl apply -f -

  log_success "Secrets created"
}

# Install ingress controller
install_ingress_controller() {
  log_info "Installing AWS Load Balancer Controller..."

  # Add Helm repository
  helm repo add eks https://aws.github.io/eks-charts
  helm repo update

  # Install AWS Load Balancer Controller
  helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
    -n kube-system \
    --set clusterName="$CLUSTER_NAME" \
    --set serviceAccount.create=true \
    --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/AmazonEKSLoadBalancerControllerRole" \
    2>/dev/null || log_warning "AWS Load Balancer Controller already installed"

  log_success "AWS Load Balancer Controller installed"
}

# Install Prometheus
install_prometheus() {
  log_info "Installing Prometheus..."

  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
  helm repo update

  helm install prometheus prometheus-community/kube-prometheus-stack \
    -n monitoring \
    --values - <<EOF
prometheus:
  prometheusSpec:
    retention: 15d
    resources:
      requests:
        cpu: 100m
        memory: 128Mi

grafana:
  enabled: true
  adminPassword: $(openssl rand -base64 12)
  persistence:
    enabled: true
    size: 10Gi

alertmanager:
  enabled: true
EOF

  log_success "Prometheus installed"
}

# Deploy backend
deploy_backend() {
  log_info "Deploying OpenPrivy backend..."

  kubectl apply -f k8s/namespace.yaml
  kubectl apply -f k8s/backend.yaml -n openprivy
  kubectl apply -f k8s/postgres.yaml -n openprivy
  kubectl apply -f k8s/redis.yaml -n openprivy
  kubectl apply -f k8s/prometheus.yaml -n openprivy
  kubectl apply -f k8s/prometheus-rules.yaml -n openprivy

  log_success "Backend deployed to Kubernetes"
}

# Wait for deployment
wait_for_deployment() {
  log_info "Waiting for backend deployment to be ready..."

  if kubectl wait --for=condition=available \
     deployment/backend -n openprivy --timeout=300s; then
    log_success "Backend deployment ready"
  else
    log_error "Backend deployment failed"
    exit 1
  fi
}

# Create load balancer
create_load_balancer() {
  log_info "Creating Application Load Balancer..."

  # Create ALB service
  kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: backend-alb
  namespace: openprivy
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
    service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
spec:
  type: LoadBalancer
  ports:
    - protocol: TCP
      port: 443
      targetPort: 3001
      name: https
    - protocol: TCP
      port: 80
      targetPort: 3001
      name: http
  selector:
    app: backend
EOF

  log_success "Load Balancer created"

  # Get ALB DNS
  log_info "Waiting for Load Balancer to be provisioned..."
  sleep 30

  ALB_DNS=$(kubectl get svc backend-alb -n openprivy -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "pending")

  if [ "$ALB_DNS" != "pending" ] && [ -n "$ALB_DNS" ]; then
    log_success "Load Balancer DNS: $ALB_DNS"
  else
    log_warning "Load Balancer still provisioning. Check later with: kubectl get svc backend-alb -n openprivy"
  fi
}

# Print summary
print_summary() {
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  ✓ OpenPrivy AWS Deployment Complete  ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
  echo ""
  echo "Cluster Information:"
  echo "  Cluster Name: $CLUSTER_NAME"
  echo "  Region: $AWS_REGION"
  echo "  Environment: $ENVIRONMENT"
  echo ""
  echo "Database Information:"
  echo "  PostgreSQL Endpoint: $RDS_ENDPOINT"
  echo "  Redis Endpoint: $REDIS_ENDPOINT"
  echo "  Master Password: Stored in AWS Secrets Manager"
  echo ""
  echo "Kubernetes Information:"
  echo "  Namespace: openprivy"
  echo "  Nodes: 3-10 (auto-scaling)"
  echo "  Instance Type: t3.large"
  echo ""
  echo "Monitoring:"
  echo "  Prometheus: kubectl port-forward -n monitoring svc/prometheus 9090:9090"
  echo "  Grafana: kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80"
  echo ""
  echo "Next Steps:"
  echo "  1. Update DNS to point to Load Balancer"
  echo "  2. Configure SSL certificate in AWS ACM"
  echo "  3. Update ingress rules with certificate"
  echo "  4. Run smoke tests: npm run test:smoke"
  echo "  5. Monitor logs: kubectl logs -n openprivy -l app=backend -f"
  echo ""
  echo "Cleanup (if needed):"
  echo "  aws cloudformation delete-stack --stack-name $DB_STACK --region $AWS_REGION --profile $AWS_PROFILE"
  echo "  aws cloudformation delete-stack --stack-name $VPC_STACK --region $AWS_REGION --profile $AWS_PROFILE"
  echo ""
}

# Main
main() {
  echo -e "\n${BLUE}╔════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  OpenPrivy AWS Deployment              ║${NC}"
  echo -e "${BLUE}║  Cluster: $CLUSTER_NAME${NC}"
  echo -e "${BLUE}║  Region: $AWS_REGION${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"

  check_prerequisites

  echo ""
  log_info "Starting infrastructure deployment..."

  deploy_vpc_eks
  get_vpc_info
  deploy_databases
  get_database_info
  configure_kubectl
  create_namespaces
  create_secrets
  install_ingress_controller
  install_prometheus
  deploy_backend
  wait_for_deployment
  create_load_balancer

  print_summary
}

# Run main
main "$@"
