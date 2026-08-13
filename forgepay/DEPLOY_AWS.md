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
# Restrict eks_public_access_cidrs to your office/VPN/CI ranges — the example
# ships 0.0.0.0/0 so a first apply succeeds from anywhere, not as a default
# to keep.

terraform init        # downloads providers (needs registry.terraform.io)
terraform validate    # <-- run here; the authoring sandbox blocks provider download
terraform plan
terraform apply
```

There is no `db_password` variable — RDS generates the master password itself
and stores it directly in Secrets Manager (`manage_master_user_password`), so
the plaintext never passes through Terraform state. Fetch it when a service
needs it:

```bash
aws secretsmanager get-secret-value \
  --secret-id "$(terraform output -raw rds_master_user_secret_arn)" \
  --query SecretString --output text
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

# External Secrets Operator (syncs AWS Secrets Manager → k8s secrets).
# Annotate its service account with the IRSA role from modules/secrets so it
# can actually read the secrets — without this it installs but every
# ExternalSecret sync fails with AccessDenied.
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$(terraform -chdir=infra/terraform output -raw secrets_reader_role_arn)"

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
- **Attach the WAF**, or it protects nothing: `web_acl_id`/the association
  resource in `modules/waf` is a no-op until `waf_alb_arn` is set.
  ```bash
  ALB_ARN=$(aws elbv2 describe-load-balancers --query \
    "LoadBalancers[?contains(LoadBalancerName,'forgepay')].LoadBalancerArn" --output text)
  terraform apply -var "waf_alb_arn=$ALB_ARN"
  ```

---

## 9. Smoke test

```bash
curl https://api.forgepay.io/health
# console: sign up → should land in /dashboard (middleware guard active)
# bureau:  GET /v1/grade-scale, GET /v1/agents/:id/score
```

---

## Known gaps to close before GA

- `terraform validate` must be run in your environment — the provider
  registry (registry.terraform.io) is unreachable from any sandboxed CI/agent
  environment behind an egress allowlist, confirmed again during the
  2026-08-13 hardening pass. `terraform fmt -check -recursive` passes and was
  used as the closest available check; resource *arguments* remain
  unvalidated until `init`/`validate` run somewhere with registry access.
- Several services still hold state in memory (see the "in-memory Map stores"
  set in the repo). agent-credit-bureau is migrated to Postgres; migrate the
  remaining stateful services (forge-custody, forge-wallet, enterprise-treasury,
  rwa-registry, yield-engine, institutional-reporting) the same way, or run
  them single-replica until then.
- Pick and wire the KYC vendor (no env key yet) — required for onboarding under
  FSCA/FIC.
- At least 5 services (`agent-decision-framework`, `agent-liquidity-manager`,
  `chain-sync`, `accounts-service`, `agent-credit-lines`) have no auth
  middleware registered on their HTTP surface at all — found 2026-08-13, not
  yet fixed. Confirm each is unreachable outside the cluster network before
  this Helm chart exposes any of them via Ingress.
- ElastiCache Redis has `transit_encryption_enabled` but no `auth_token` —
  anything that can reach the port inside the VPC connects without a
  credential. Fine behind strict security groups; add an auth token
  (sourced the same way `rds_master_user_secret_arn` now is) before treating
  network segmentation as the only control.
