# Deploying ForgePay to AWS

An ordered runbook from empty AWS account to a running platform. Pairs with
`EXTERNAL_DEPENDENCIES.md` (what to provision) and `infra/terraform` (how).

Target: `us-east-1` (or `af-south-1` for the South Africa deployment — see
`SOUTH_AFRICA_DEPLOYMENT.md`). ACM cert for CloudFront must be in `us-east-1`.

---

## 0. Prerequisites (local / CI)

```bash
aws --version         # v2
terraform -version    # >= 1.6  (this repo authored against 1.8.5)
kubectl version --client
helm version
docker --version
```

Authenticate: `aws configure` (or an assumed CI role with admin for the first
apply).

---

## 1. Bootstrap Terraform remote state (once per account)

The root uses an S3 backend + DynamoDB lock table. Create them first:

```bash
cd infra/terraform/bootstrap
terraform init && terraform apply   # creates the state bucket + lock table
```

---

## 2. Provision the infrastructure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Fill in: environment, db_username, acm_certificate_arn, alert_email.
# Provide the DB password out-of-band, NOT in the file:
export TF_VAR_db_password='...'          # or pull from Secrets Manager

terraform init        # downloads providers (needs registry.terraform.io)
terraform validate    # <-- run here; the authoring sandbox blocks provider download
terraform plan
terraform apply
```

This stands up VPC, EKS, RDS Postgres, ElastiCache Redis, S3, CloudFront,
KMS, Vault IAM + unseal key, CloudWatch/SNS. Grab the outputs:

```bash
terraform output          # eks_cluster_name, rds_endpoint, redis_endpoint, ...
aws eks update-kubeconfig --name "$(terraform output -raw eks_cluster_name)"
```

---

## 3. Cluster add-ons

```bash
# AWS Load Balancer Controller (creates the ALB the ingress uses)
helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName="$(terraform output -raw eks_cluster_name)"

# External Secrets Operator (syncs AWS Secrets Manager → k8s secrets)
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace

# Vault (auto-unseal via the KMS key from the vault module)
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install vault hashicorp/vault -n forgepay --create-namespace -f infra/helm/... 
```

---

## 4. Secrets

Put every credential from `EXTERNAL_DEPENDENCIES.md` into AWS Secrets Manager
(or Vault), then reference them via ExternalSecret manifests — never in Helm
values. Generate the platform's own secrets:

```bash
for s in JWT_SECRET ENCRYPTION_KEY INTERNAL_WEBHOOK_SECRET CONSOLE_SECRET; do
  aws secretsmanager create-secret --name forgepay/$s --secret-string "$(openssl rand -hex 32)"
done
```

---

## 5. Database migrations

RDS is empty. Apply each service's schema (they self-migrate on boot when
`DATABASE_URL`/`DB_HOST` is set — e.g. agent-credit-bureau runs migrations in
`initPersistence()`), and the console schema explicitly:

```bash
cd apps/platform && DATABASE_URL='postgres://…' npm run db:migrate   # users/tenants
```

---

## 6. Build & push images

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
# per service:
docker build -t <acct>.dkr.ecr.<region>.amazonaws.com/forgepay/<svc>:<sha> services/<svc>
docker push  <acct>.dkr.ecr.<region>.amazonaws.com/forgepay/<svc>:<sha>
```

---

## 7. Deploy the services

```bash
# Umbrella chart wires all services together:
helm upgrade --install forgepay infra/helm/forgepay-stack \
  -n forgepay --create-namespace \
  --set global.image.registry=<acct>.dkr.ecr.<region>.amazonaws.com \
  --set global.image.tag=<sha> \
  -f infra/helm/values.<environment>.yaml
```

Validate charts first with `helm lint` / `helm template` (CI already does
this). Confirm rollout:

```bash
kubectl -n forgepay get pods
kubectl -n forgepay get ingress          # ALB hostname
```

---

## 8. DNS + CDN cutover

- Point Route 53 records (`api.forgepay.io`, `checkout.forgepay.io`,
  `app.forgepay.io`) at the CloudFront distribution / ALB.
- Re-apply Terraform with the real ALB hostname in `cloudfront.alb_domain_name`
  (it's a placeholder until the LB controller has created the ALB).

---

## 9. Smoke test

```bash
curl https://api.forgepay.io/health
# console: sign up → should land in /dashboard (middleware guard active)
# bureau:  GET /v1/grade-scale, GET /v1/agents/:id/score
```

---

## Known gaps to close before GA

- `terraform validate` must be run in your environment (the authoring sandbox
  blocks the provider registry) before first apply.
- Several services still hold state in memory (see the "in-memory Map stores"
  set in the repo). agent-credit-bureau is migrated to Postgres; migrate the
  remaining stateful services (forge-custody, forge-wallet, enterprise-treasury,
  rwa-registry, yield-engine, institutional-reporting) the same way, or run
  them single-replica until then.
- Pick and wire the KYC vendor (no env key yet) — required for onboarding under
  FSCA/FIC.
