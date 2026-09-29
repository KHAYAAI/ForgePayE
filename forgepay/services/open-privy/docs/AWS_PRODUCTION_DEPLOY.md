# OpenPrivy — AWS Production Deployment Runbook

This is the real, ordered procedure to stand up the backend on AWS. It reflects
what the code and IaC in this repo actually do. Where a step needs something
this repo cannot provide (an AWS account, a domain, an audit), that is called
out explicitly rather than assumed done.

Architecture: **ALB → EKS (backend pods) → RDS PostgreSQL (Multi-AZ) + ElastiCache Redis**,
with the encryption master key in **AWS Secrets Manager** (read by pods via IRSA).

---

## 0. Prerequisites (you provide these)

- An AWS account + an operator with permissions for CloudFormation, EKS, RDS,
  ElastiCache, IAM, Secrets Manager, ECR, ACM.
- `aws` CLI v2, `kubectl`, `eksctl` (optional), `docker` locally.
- A registered domain and a Route53 hosted zone (for `api.openprivy.io`).
- An ACM certificate for the API hostname (for ALB TLS).
- A Supabase project (auth) — URL + service key.
- RPC providers: Alchemy (Ethereum/Polygon), Pimlico (bundler/paymaster) — API keys.

Nothing below stores secrets in the repo. Real values live in AWS Secrets
Manager / the cluster, injected at deploy time.

---

## 1. Network + cluster (CloudFormation)

Both templates are `cfn-lint`-clean.

```bash
aws cloudformation deploy \
  --template-file aws/cloudformation-vpc-eks.yaml \
  --stack-name openprivy-vpc-eks \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides ClusterName=openprivy-prod
```

Grab the VPC + private subnet IDs from the stack outputs, then:

```bash
aws cloudformation deploy \
  --template-file aws/cloudformation-databases.yaml \
  --stack-name openprivy-databases \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      ClusterName=openprivy-prod \
      VpcId=<vpc-id> \
      PrivateSubnet1=<subnet-1> \
      PrivateSubnet2=<subnet-2>
```

This provisions RDS PostgreSQL 16 (Multi-AZ, encrypted, 30-day backups), an
ElastiCache Redis replication group (encrypted in transit + at rest, automatic
failover), a KMS key, an S3 backup bucket, CloudWatch alarms, and a
Secrets-Manager-generated DB password (no plaintext password parameter).

Outputs you will need: `RDSEndpoint`, `RedisEndpoint`, `DBSecretArn`.

---

## 2. Encryption master key (Secrets Manager)

The backend refuses to start without a master key and, in production, reads it
from Secrets Manager — the key never appears in a manifest or env file.

```bash
aws secretsmanager create-secret \
  --name openprivy-prod/encryption/master-key \
  --secret-string "$(openssl rand -base64 32)"
```

Note the returned ARN → this goes into `ENCRYPTION_MASTER_KEY_SECRET_ARN`
(k8s/backend.yaml ConfigMap). The pod's IRSA role must allow
`secretsmanager:GetSecretValue` on this ARN.

> Rotation: generate a new 32-byte key, then re-encrypt existing wallet rows with
> `EncryptionService.rotateKey(old, new)` before flipping the secret. Do not
> rotate the secret without re-encrypting — existing ciphertext becomes
> undecryptable. (Rotation tooling is a tracked follow-up; the primitive exists.)

---

## 3. Container image (ECR)

The Dockerfile is a multi-stage build; context is the repo root.

```bash
aws ecr create-repository --repository-name openprivy-backend
docker build -f services/backend/Dockerfile -t openprivy-backend:prod .
docker tag openprivy-backend:prod <acct>.dkr.ecr.<region>.amazonaws.com/openprivy-backend:<sha>
docker push <acct>.dkr.ecr.<region>.amazonaws.com/openprivy-backend:<sha>
```

(CI does this automatically on push to `production` — see
`.github/workflows/deploy-aws.yml`, which also runs Trivy image scanning.)

---

## 4. Cluster bootstrap (one-time)

1. `aws eks update-kubeconfig --name openprivy-prod --region <region>`
2. Install the **AWS Load Balancer Controller** (for the ALB Ingress).
3. Create the **IRSA role** for the backend ServiceAccount with
   `secretsmanager:GetSecretValue` on the master-key secret, and put its ARN in
   the `eks.amazonaws.com/role-arn` annotation in `k8s/backend.yaml`.
4. Fill the real values into `k8s/backend.yaml` (ConfigMap ARNs/region) and the
   `backend-secrets` Secret — **or** wire the External Secrets Operator to sync
   `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, RPC keys, and Supabase creds from
   Secrets Manager (recommended; the committed Secret is a sandbox placeholder).
5. `kubectl apply -f k8s/namespace.yaml`

---

## 5. Schema (migrations, not synchronize)

Production **never** uses TypeORM `synchronize`. Schema comes from the committed
migration in `services/backend/src/migrations/`, applied by a run-once Job:

```bash
kubectl apply -f k8s/migrate-job.yaml   # CI substitutes the real image tag
kubectl wait --for=condition=complete job/db-migrate -n openprivy --timeout=300s
```

This migration was verified locally against a fresh PostgreSQL 16: it creates all
seven tables (users, wallets, transactions, audit_logs, recovery_contacts,
recovery_guardians, migrations) with the correct FKs.

---

## 6. Roll out the backend

```bash
kubectl apply -f k8s/backend.yaml      # ConfigMap, Secret, Deployment, SA, Service, HPA
kubectl apply -f k8s/ingress.yaml      # ALB + TLS (ACM cert ARN required)
kubectl rollout status deployment/backend -n openprivy --timeout=5m
```

Deployment specifics already in the manifest: 3 replicas, HPA 3→10 on CPU/mem,
rolling update with `maxUnavailable: 0`, pod anti-affinity, non-root +
read-only-rootfs + dropped capabilities, `/health` liveness/readiness probes,
Prometheus scrape annotations.

Point Route53 `api.openprivy.io` at the ALB the Ingress creates.

---

## 7. Verify

```bash
curl -fsS https://api.openprivy.io/health          # {"status":"ok",...}
curl -fsS https://api.openprivy.io/metrics | head  # Prometheus exposition
```

Rate limiting is Redis-backed, so limits are global across pods (verified
locally: `/auth/login` blocks with HTTP 429 after 5 attempts/min, and the
`rl:ip` / `rl:login` keys appear in Redis).

---

## What is verified vs. what still gates "live"

**Verified in this repo (locally reproducible):**
- Backend builds, lints, and passes 32 unit/correctness/security tests.
- Boots in `NODE_ENV=production` against PostgreSQL with the migration-based
  schema (no synchronize) and Redis-backed rate limiting.
- Custodial wallet create works end-to-end over HTTP; private key encrypted at
  rest; JWT guard returns 401 unauthenticated; no key leaked in responses.
- Both CloudFormation templates are `cfn-lint`-clean; all k8s manifests parse.

**Still required before real production traffic (cannot be self-certified here):**
1. **External security audit** of custody + AA + auth (independent, not us).
2. **Live ERC-4337 send** proven on a testnet against a real EntryPoint; reconcile
   `SimpleAccount.sol`'s nonce model with EntryPoint v0.7.
3. **Supabase-backed auth** exercised end-to-end (booted here with dummy config).
4. **Load test** on staging to size RDS/Redis/HPA against real numbers.
5. **Master-key rotation** tooling and a runbook dry-run.
6. **DR drill**: restore RDS from snapshot; fail over Multi-AZ; confirm decrypt.

Treat "production ready" as earned by items 1–6 passing, not asserted.
