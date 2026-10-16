# Deploying the console: what the workflow expects

**16 October 2026.** `.github/workflows/deploy-platform.yml` deploys the console to Kubernetes. It is manual, by image digest, with short-lived AWS credentials,
behind an approval. This page is the contract: what GitHub and AWS must provide. The AWS build-out itself is yours; nothing here creates anything.

## How a deploy goes

1. `forgepay-bureau-images.yml` builds and scans the console image and prints its reference in the job summary: `ghcr.io/<owner>/forgepay-console@sha256:<64 hex>`.
2. Actions > *Deploy ForgePay Console* > Run workflow. Paste that reference as `image`. **Leave `dry_run` ticked the first time.**
3. The job waits for a reviewer on the `production` environment.
4. It signs in to AWS by OIDC (no stored keys), connects to the cluster, and runs `helm upgrade --install` of `infra/helm/console`.
   A dry run only asks the cluster to validate (`--dry-run=server`) and changes nothing. A live run uses `--atomic`: if the new pods are not ready in ten
   minutes it rolls back to what was running.
5. A live run then checks that **every running pod's image ID contains the approved digest**, and that `https://<CONSOLE_HOST>/api/healthz` answers through the real load balancer.

It refuses a tag, a short or upper-case digest, a missing variable, or a run from any branch but `main`. The chart itself refuses to render without a valid digest and a named Secret.

## GitHub

- **Environment `production`** (Settings > Environments): add **required reviewers** and limit **deployment branches to `main`**. Without reviewers nothing waits for anyone;
  the workflow cannot enforce that for you.
- **Variables on that environment** (not secrets; none of these is sensitive):

  | Variable | Example |
  |---|---|
  | `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account>:role/forgepay-console-deploy` |
  | `AWS_REGION` | `af-south-1` or `eu-west-2` |
  | `EKS_CLUSTER_NAME` | `forgepay-prod` |
  | `ACM_CERT_ARN` | certificate in the load balancer's region |
  | `CONSOLE_HOST` | `console.myforgepay.com` |
  | `K8S_NAMESPACE` (optional) | `forgepay` (default) |
  | `CONSOLE_SECRET_NAME` (optional) | `console-secrets` (default) |

- No AWS access keys are stored anywhere. If any exist from the old workflow (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), delete them.

## AWS

1. **OIDC identity provider**: URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. **IAM role** with this **trust policy**. The `sub` condition is what limits it to this repository's `production` environment; do not loosen it to a wildcard. IAM compares it case-sensitively, so write the owner and repository exactly as GitHub spells them (`KHAYAAI/ForgePayE`); a wrong-case name is the commonest reason the role cannot be assumed:
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

**Checked here:** the workflow passes `actionlint`; the image-reference check accepts digest references and rejects tags, short or upper-case digests, other algorithms, URLs and injection-style
strings (tested); the chart lints and renders (built `helm` v3.15 from source) and **refuses** a missing, short, upper-case or wrong-algorithm digest, a tag, a missing Secret name and a missing host, each for
its own reason; the same checks run in CI on every change. The console's two credential fallbacks were fixed and tested.

**Not checked, and only your first dry run can show:** that the role assumes through OIDC, that it reaches the cluster and is allowed in, that the cluster accepts the rendered resources,
that pods start with your Secret, and the public check through your load balancer. None of this has run against a real cluster. The dry run exercises the first four without changing anything.

## Still to do (not in this change)

- **Verify the image's origin, not just its digest.** The digest says "this exact image"; it does not say "built by our pipeline". Signing images in `forgepay-bureau-images.yml` (cosign, keyless) and
  verifying the signature in the deploy step would close that.
- Move the other services (bureau, gateway, custody) to the same pattern: digest-only charts and one manual, approved workflow each.
- Pin third-party actions to commit SHAs.
