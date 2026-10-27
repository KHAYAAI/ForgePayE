# Deploying services: what the workflow expects

**16 October 2026; updated 27 October** (staging target, compliance monitor). `.github/workflows/deploy-service.yml` deploys the **console, the credit bureau, the stablecoin gateway or the compliance monitor** to Kubernetes, in **staging** or **production**. It is manual, by image
digest, only for images our own pipeline **signed**, with short-lived AWS credentials, behind an approval. This page is the contract: what GitHub and AWS must provide.
The AWS build-out itself is yours; nothing here creates anything.

## How a deploy goes

1. `forgepay-bureau-images.yml` builds each image, **scans** it, then **signs** it (cosign, keyless) and checks its own signature. Only then does it list the image reference in its job
   summary: `ghcr.io/<owner>/forgepay-<service>@sha256:<64 hex>`. So a listed digest has been built by that workflow and has passed the scan.
2. Actions > *Deploy ForgePay service* > Run workflow. Choose the `target` (**staging** first), the `service`, and paste its reference as `image`. **Leave `dry_run` ticked the first time.**
3. **Before it touches AWS** it checks, in order: the reference is a digest (never a tag); it is the repository expected for the service you chose; and the image's **signature verifies
   as made by the images workflow on `main`** (override with the `IMAGE_SIGNER_REF` variable). An image built on a working branch, or by anything else, is refused here and nothing is deployed.
4. The job waits for a reviewer on the target's environment (`staging` or `production`), then signs in to AWS by OIDC (no stored keys), connects to the cluster, and runs `helm upgrade --install`.
   A dry run only asks the cluster to validate (`--dry-run=server`) and changes nothing. A live run uses `--atomic`: if the new pods are not ready in ten minutes it rolls back.
5. A live run then checks that **every running pod's image ID contains the approved digest**; for the console it also checks that `https://<CONSOLE_HOST>/api/healthz` answers through the real load balancer.

| `service` | Chart | Release | Notes |
|---|---|---|---|
| `console` | `infra/helm/console` | `console` | needs `ACM_CERT_ARN`, `CONSOLE_HOST`; secrets from the Kubernetes Secret named by `CONSOLE_SECRET_NAME` |
| `agent-credit-bureau` | `infra/helm/agent-credit-bureau` | `bureau` | secrets from `bureau-agent-credit-bureau-secrets`; see `infra/launch/bureau/` |
| `stablecoin-gateway` | `infra/helm/stablecoin-gateway` | `stablecoin-gateway` | secrets from `forgepay-stablecoin-gateway-secrets` plus the wallet key Secrets |
| `compliance-monitor` | `infra/helm/compliance-monitor` | `compliance-monitor` | secrets from `compliance-monitor-secrets`; runs `alembic upgrade head` as a pre-install/pre-upgrade Job |

The chart's `values-staging.yaml` (target `staging`) or `values-prod.yaml` (target `production`) is applied. If the file does not exist the chart's own defaults are used **and the run warns**.
Today every wave-1 chart has `values-staging.yaml`; only the console has `values-prod.yaml`. The staging checklist is `16-wave1-staging.md`.

Each chart refuses to render, when `image.requireDigest` is on (the workflow turns it on), without a valid `sha256:<64 hex>`. They are off by default in the charts so existing installs and examples are unchanged.

## Custody signing nodes

Each node lives in its own cluster and account, so it is not deployed by this workflow. Its operators run `infra/launch/verify-image-signature.sh <image@sha256:…>` first (the same check as step 3),
then install `infra/helm/mpc-node` with `image.requireDigest=true` and `image.digest=<the digest>`. The vendored `openfireblocks` chart has the same switch (`requireDigests`). The real custody repository
(`KHAYAAI/openfireblocks`) needs the same two changes in its own charts; that is not done there.

## Why the signature, as well as the digest

A digest says "this exact image". It does not say who made it: anyone who can push to the registry, or who steals a token that can, can publish an image with a different digest and ask for it to be
deployed. The signature is made with a short-lived certificate that GitHub's OIDC token earns only for the images workflow on a given ref, so it can only be produced by running that workflow, which
scans first. There is no signing key to steal. It is recorded in the public Sigstore transparency log (this repository is public, so that discloses nothing new).

## GitHub

- **Environments `staging` and `production`** (Settings > Environments): on each, add **required reviewers** and limit **deployment branches to `main`**. Without reviewers nothing
  waits for anyone; the workflow cannot enforce that for you. Each environment carries its own variables, so staging points at the staging account and cluster.
- **Variables on each environment** (not secrets; none of these is sensitive). Production examples below; staging uses its own account's role, `forgepay-staging` and `console.staging.myforgepay.com`:

  | Variable | Example |
  |---|---|
  | `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account>:role/forgepay-console-deploy` |
  | `AWS_REGION` | `af-south-1` or `eu-west-2` |
  | `EKS_CLUSTER_NAME` | `forgepay-prod` |
  | `ACM_CERT_ARN` | certificate in the load balancer's region |
  | `CONSOLE_HOST` | `console.myforgepay.com` |
  | `K8S_NAMESPACE` (optional) | `forgepay` (default) |
  | `CONSOLE_SECRET_NAME` (optional) | `console-secrets` (default) |

  Optional: `IMAGE_SIGNER_REF` (default `refs/heads/main`): the ref the images workflow must have signed from. Leave it as `main` for production.
- The packages the images workflow publishes must be readable by the deploy job (it uses the workflow's own token to read the signature). If a package is private, make sure the repository has access to it.
- No AWS access keys are stored anywhere. If any exist from the old workflow (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), delete them.

## AWS

1. **OIDC identity provider**: URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. **IAM role** with this **trust policy**, one per account: the staging account's role trusts `environment:staging`, production's trusts `environment:production`. The `sub` condition is what limits it to that environment; do not loosen it to a wildcard. IAM compares it case-sensitively, so write the owner and repository exactly as GitHub spells them (`KHAYAAI/ForgePayE`); a wrong-case name is the commonest reason the role cannot be assumed:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": {
           "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
           "token.actions.githubusercontent.com:sub": "repo:KHAYAAI/ForgePayE:environment:production"
         }
       }
     }]
   }
   ```
3. **Permissions on the role**: only `eks:DescribeCluster` on the cluster's ARN (that is all `aws eks update-kubeconfig` needs). Nothing else in AWS.
4. **Let the role into the cluster, in one namespace**: an EKS *access entry* for the role with an access policy (for example `AmazonEKSEditPolicy`) scoped to the `forgepay` namespace.
   It can then manage the console's resources there and nothing cluster-wide. (The cluster must use the API or API-and-ConfigMap authentication mode.)

## In the cluster, before the first run

- The **namespace** exists (the workflow does not create it).
- **AWS Load Balancer Controller** is installed (the chart's Ingress uses class `alb`), and a **DNS record** for `CONSOLE_HOST` points at the load balancer.
- A Kubernetes **Secret** (name = `CONSOLE_SECRET_NAME`), created from AWS Secrets Manager or Vault, never from this repository. The pod will not start without it, by design. From the code:

  | Key | Notes |
  |---|---|
  | `JWT_SECRET` | **Required**: the console refuses to start in production without 32+ characters |
  | `INTERNAL_WEBHOOK_SECRET` | shared with unified-router |
  | `DATABASE_URL` | the console's Postgres |
  | `BUREAU_ADMIN_API_KEY` | the console presents this to the bureau. **Unset now means no credential is sent** (it used to fall back to a published development key) |
  | `FORGE_OPERATOR_TENANT_ID` | the workspace that operates the bureau |
  | `REDIS_URL` | shared login throttling across replicas |
  | `TOTP_ENCRYPTION_KEY` | 64 hex characters |
  | `TREASURY_API_KEY` | same rule as the bureau key |
  | `OPENFIREBLOCKS_URL`, `OPENFIREBLOCKS_ADMIN_KEY`, `CUSTODY_ACTOR_SECRET`, `SMTP_*`, `WORKOS_*` | only for the features you switch on |

- If the image package is **private**, either make the package public or create an image pull Secret and list it under `imagePullSecrets` in `values-prod.yaml`.

## What was checked, and what was not

**Checked here:**
- Both workflows pass `actionlint`.
- The image-reference check accepts digest references and rejects tags, short or upper-case digests, other algorithms, URLs and injection-style strings.
- The verification script was tested against a stand-in `cosign`: it refuses a tag, a bad digest, an unusual ref and a missing `cosign` before verifying anything, and passes the right identity (this workflow, this repository, the chosen ref).
- All four charts that can run production workloads render **byte-for-byte identically** to before with default settings, use a digest when given, and **refuse** a missing, short, upper-case or wrong-algorithm one (checked with a locally built `helm` v3.15, and in CI on every change).
- 98 third-party action references are pinned to commit SHAs, and a CI job fails on any new unpinned one.

**Not checked, and only the first real runs can show:**
- **Signing and its self-check have run, in CI** (16 October, commit `5d82adc0`): all eight image jobs scanned, signed keylessly, and verified their own signature straight away, using the same identity format the deploy expects. They signed as the images workflow **on the working branch**.
- **The deploy workflow's own verification has not run**, and cannot yet: it demands the identity of the images workflow **on `main`**, which does not exist until images are built from `main`. That, and the deploy workflow as a whole, are first exercised by the first dry run.
- Everything about AWS: the role assuming through OIDC, reaching the cluster, being allowed in, pods starting with your Secret, the public check. A dry run exercises the first four without changing anything.
- Images built from the working branch are signed with that branch's identity, and the deploy workflow accepts only `main`. **Nothing can be deployed to production until this work is on `main` and the images workflow has run there.** That is the intended gate, not a defect.

## Still to do

- The real custody repository's charts need the same digest switch.
- Pinned actions are kept current by Dependabot (weekly); review those pull requests like any other change.
- Admission control in the cluster (a policy that refuses unsigned images at the Kubernetes level) would catch a deploy that bypasses this workflow. Not set up.
