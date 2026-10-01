# Deploying threshold custody

An ordered runbook for standing up the FORGE threshold-signing stack: three signing nodes in three trust domains, the
coordinator, the OpenFireblocks api-gateway, and the stablecoin gateway that moves money through them. It ties together
the Helm charts, the Terraform modules and the CI added for them. The cryptography and its guarantees are in
`services/openfireblocks/docs/threshold-signing.md`; backups and recovery are in `services/openfireblocks/docs/disaster-recovery.md`.

**What was and was not tested.** The charts render and lint, the Terraform modules validate, the workflows lint, and the
gateway's tests and migrations run (see "Validation status" at the end). Nothing in this runbook has been run end to end
on a real cluster or against a real AWS account or Vault. Treat each step's verification as part of the step.

## 0. The shape of it

```
                      trust domain A            trust domain B            trust domain C
                    ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
                    │ mpc-node1     │◄──mTLS─►│ mpc-node2     │◄──mTLS─►│ mpc-node3     │
                    │ KMS key (A)   │         │ KMS key (B)   │         │ Vault (C)     │
                    │ policy (A)    │         │ policy (B)    │         │ policy (C)    │
                    └──────▲────────┘         └──────▲────────┘         └──────▲────────┘
                           │ mTLS (CN=coordinator)   │                         │
                    ┌──────┴─────────────────────────┴─────────────────────────┴──────┐
                    │ mpc-signer (coordinator)   ←   api-gateway            (platform cluster)     │
                    └───────────────────────────────────────────────────────────────────┘
                    stablecoin-gateway: separate release, same cluster; not wired to the coordinator
```

* Each `mpc-node` is its own Helm release (`infra/helm/mpc-node`), normally in its own cluster/account, with its own seal
  key, its own policy file, and its own backup destination. **No two nodes should share an administrator.**
* The coordinator (`mpc-signer`) and the api-gateway are in the OpenFireblocks chart
  (`services/openfireblocks/infrastructure/helm/openfireblocks`). The coordinator holds an ed25519 key that signs session
  requests and a client certificate; it never holds a share.
* The stablecoin gateway (`infra/helm/stablecoin-gateway`) holds deposit keys wrapped by Vault or KMS and runs the
  settlement, payout, sweeper and treasury workers. Today it signs payouts with a single hot key read from a file
  (`PAYOUT_SIGNER_KEY_FILE`); it does not call the MPC coordinator itself.

Who does what: steps 1, 3 (CA), 4 (recovery key) and 5-6 are done **by each node's own operators or jointly** as noted;
only steps 7-9 belong to the platform team.

## 1. Seal keys: Vault or KMS (per node)

Each node's seal key wraps everything the node stores. It must live in that node's trust domain.

**AWS KMS** (Terraform, once per node with a provider for that node's account): module `infra/terraform/modules/kms-keys`,
example `infra/terraform/examples/threshold-custody`.

```hcl
module "kms_node1" {
  source             = "../../modules/kms-keys"
  providers          = { aws = aws.node1 }
  environment        = "production"
  deposit_key_enabled = false
  mpc_node_ids       = ["node1"]
  mpc_node_user_arns = { node1 = [var.node1_role_arn] }   # the node's IRSA role
}
```
It creates a symmetric key with rotation on and a 30-day deletion window, an alias, a key policy that lets the node role
`kms:GenerateDataKey` / `kms:Decrypt` **only** with encryption context `mpc-node = <id>` (plus an explicit Deny to everyone
else), and a least-privilege IAM policy. Use the key **ARN** as `seal.awskms.keyId`, never the alias.
Run `mpc-node seal-check -provider awskms` with the node's credentials before first use; it wraps a throwaway key under the
context `mpc-node = seal-check`, which is why the module admits that context unless you set `allow_seal_check_context = false`.

**Vault**: a transit key `mpc-node-<id>` in the node's own Vault and an AppRole limited to it
(`services/openfireblocks/deploy/mpc/vault-policy.example.hcl`). Store `role-id` / `secret-id` as a Kubernetes Secret in the
node's cluster (step 5). `mpc-node seal-check -provider vault` verifies it for real.

**Stablecoin-gateway deposit-key wrapping** is a separate key in the platform account: the same `kms-keys` module with
`deposit_key_enabled = true` and `deposit_key_user_arns = [<gateway IRSA role>]`; the gateway wraps with context
`purpose = deposit-keys` (`deploy/aws/kms-policy.example.json`). Verify with
`KEY_WRAP_PROVIDER=awskms KEY_WRAP_KMS_KEY_ID=<arn> npx tsx scripts/verify-key-custody.ts`.

## 2. Secret containers (platform account)

`infra/terraform/modules/secrets` now also creates empty Secrets Manager containers (names only) for the custody path
and a Parameter Store entry for the public cold address. **Terraform never sees a value.** Write values out of band:

```bash
aws secretsmanager put-secret-value --secret-id forgepay/production/stablecoin/admin-api-keys --secret-string "$(openssl rand -hex 32)"
aws ssm put-parameter --name /forgepay/production/stablecoin/treasury-cold-address --type String --overwrite --value 0x...
```

See "Secrets that must exist beforehand" below for the full list and who consumes each. Sync them into Kubernetes Secrets
with External Secrets (the existing `secrets_reader_role_arn` output is the IRSA role for it).

## 3. PKI and certificates

One private CA for the cluster. Whoever holds `ca.key` can mint a certificate for any node, so agree who that is
(ideally an offline ceremony, not a node's operator).

```bash
mpc-node pki-init -dir ca                                       # once; nodes need only ca/ca.pem
mpc-node pki-issue -ca ca -name node1 -hosts node1.mpc.account-a.example -out node1-tls
mpc-node pki-issue -ca ca -name node2 -hosts node2.mpc.account-b.example -out node2-tls
mpc-node pki-issue -ca ca -name node3 -hosts node3.mpc.operator-c.example -out node3-tls
mpc-node pki-issue -ca ca -name coordinator -hosts mpc-signer -out coordinator-tls
```
Each certificate's **common name is the node id** (`coordinator` for the coordinator), with server and client auth. Either
load each as a Secret with keys `tls.crt`, `tls.key`, `ca.crt` (`values-node2.yaml` shows the command), or let cert-manager
issue them from a CA issuer built from this CA (`tls.certManager.enabled`, `values-node1.yaml`). Certificates last 90 days by
default; the running processes reload renewed files without a restart, and `preflight` warns inside 14 days of expiry.

Also generate the coordinator's session-signing key (once, on the coordinator's side; keep the public half):

```bash
mpc-node coordinator-key -out coordinator.key        # prints the public key (hex): -coordinator-pub below
kubectl -n openfireblocks create secret generic ofb-coordinator-key --from-file=coordinator.key
```

## 4. Backups (before the nodes start)

`MPC_ENV=production` **refuses to start a node without backups**, so this comes before step 6, not after.

1. **Recovery key** (a ceremony; `disaster-recovery.md`): `mpc-node backup-keygen -k 3 -n 5 -out DIR` splits the private
   half among five officers; only `DIR/recipient.txt` (`fprec1:...`) goes to the nodes as `MPC_BACKUP_RECIPIENTS`.
2. **Destination**, per node, in an account other than the node's own so losing that account does not lose its backups:
   Terraform module `infra/terraform/modules/mpc-backup-bucket` (versioned, SSE-KMS, private, deletes denied to everyone but one
   pruner role; the node prunes its own superseded backups, so pass the node's role as `backup_pruner_role_arn`). Object Lock
   is **off** by default: it stops the node pruning retired shares after a reshare, so an old share's backup would survive for
   the lock's duration. Read the trade-off on the variable before enabling it. `noncurrent_version_expiration_days` is how long
   a pruned backup stays recoverable (default 30).
3. Set `backup.recipients` and `backup.s3.*` (or `backup.dir`) in each node's values.

## 5. Install the three mpc-node releases (init)

Per node, with the node's own kube-context and credentials. First create what the node references:

```bash
kubectl create namespace mpc
kubectl -n mpc create secret generic mpc-node3-approle --from-literal=role-id=... --from-literal=secret-id=...   # Vault nodes
kubectl -n mpc create secret generic mpc-node2-tls --from-file=tls.crt=... --from-file=tls.key=... --from-file=ca.crt=...   # hand-issued certs
```
Then the one-time init (identity creation; nothing runs yet):

```bash
helm upgrade --install mpc-node1 infra/helm/mpc-node -n mpc -f infra/helm/mpc-node/values-node1.yaml \
  --set init.enabled=true --set serve.enabled=false
kubectl -n mpc wait --for=condition=complete job/mpc-node1-init --timeout=10m
kubectl -n mpc logs job/mpc-node1-init -c export-identity > node1.identity.json
```
Collect the three public `*.identity.json` files and build the cluster file (public; safe to share):

```bash
mpc-node cluster -threshold 1 -coordinator-pub <hex from step 3> -out cluster.json \
  node1.identity.json node2.identity.json node3.identity.json
```
`-threshold 1` is a 2-of-3 cluster. The command checks the file's structure only (node count, threshold, ids, key lengths, URLs).
The trust-domain rule (no one domain may hold `t+1` nodes, judged from the `-domain` labels each node was initialised with) is
enforced by `preflight`, at node and coordinator start-up, and at key generation, so a wrong label is caught in step 6, not here.

## 6. Preflight, then serve (each node)

```bash
helm upgrade mpc-node1 infra/helm/mpc-node -n mpc -f infra/helm/mpc-node/values-node1.yaml \
  --set-file cluster.json=cluster.json --set init.enabled=false --set serve.enabled=false --set preflight.job.enabled=true
kubectl -n mpc logs job/mpc-node1-preflight          # every line ok/warn, final line: ready
```
Fix anything `FAIL`ed (typical: a certificate with the wrong name, a Vault policy that cannot unwrap, a one-domain topology, a
data directory not 0700, no backups). Then start the node and drop the Job:

```bash
helm upgrade mpc-node1 infra/helm/mpc-node -n mpc -f infra/helm/mpc-node/values-node1.yaml --set-file cluster.json=cluster.json
kubectl -n mpc logs statefulset/mpc-node1 -c preflight      # repeated automatically at every start
kubectl -n mpc logs statefulset/mpc-node1 -c mpc-node       # "listening", "key-share backups on: ...", the policy digest
```
Before the coordinator can reach a node, that node's `networkPolicy.ingress.from` must admit the coordinator's egress
addresses and its peers (the examples use `ipBlock`s); with it empty the node is unreachable by design.

## 7. The coordinator (mpc-signer)

In the platform cluster, with the OpenFireblocks chart:

```bash
helm upgrade --install ofb services/openfireblocks/infrastructure/helm/openfireblocks -n openfireblocks \
  --set apiGateway.thresholdSigning=true \
  --set mpcSigner.threshold.enabled=true \
  --set-file mpcSigner.threshold.cluster.json=cluster.json \
  --set mpcSigner.threshold.coordinatorKeySecret.name=ofb-coordinator-key \
  --set mpcSigner.threshold.tls.existingSecret=ofb-coordinator-tls \
  --set networkPolicy.enabled=true        # then also set networkPolicy.nodePeers (see ci/threshold-values.yaml)
  ...
```
`MPC_REQUIRED=true` makes the signer refuse the legacy shared key and refuse to start without a cluster; `MPC_ENV=production`
makes it require mutual TLS. Check `kubectl logs deploy/ofb-openfireblocks-mpc-signer`: `threshold signing enabled: 2-of-3 across 3
trust domain(s)` and no `WARNING: trust domain ... holds enough signing nodes`.

## 8. The api-gateway

Same release as step 7. Needs `DATABASE_URL` and `ADMIN_API_KEY` in the Secret named by `external.databaseUrlSecret`, the
Temporal address (`external.temporalHostPort`), and a broadcast RPC (`external.ethereumRpcUrl`) if it should send
transactions. The gateway backfills a key for every existing workspace at start (`KEY_BACKFILL_ON_START`, default on): expect
keygen CPU load on the nodes during the first start; `POST /admin/custody/keys/backfill` reports `{created, already, failed}`.

## 9. The stablecoin gateway

```bash
helm upgrade --install stablecoin-gateway infra/helm/stablecoin-gateway -n forgepay -f my-gateway-values.yaml
```
Use `infra/helm/stablecoin-gateway/ci/production-values.yaml` as the template. Points that bite:

* **`CORS_ALLOWED_ORIGINS` is required in production** (`config.CORS_ALLOWED_ORIGINS`): the gateway refuses to start without it.
  The chart does not enforce it, the application does.
* **Replicas.** The settlement poller, payout worker, sweeper and treasury manager move money and must run in exactly one place.
  `leaderLock.enabled` (`LEADER_LOCK_ENABLED`, default `true`) makes the replicas compete for a Postgres session-level advisory
  lock; only the holder runs the workers, the others serve HTTP, and a standby takes over within `LEADER_RETRY_MS` if the
  leader's connection dies. **`replicaCount: 1` is the chart default.** Raise it only once the image you deploy contains the leader
  election (`src/lib/leader.ts`), and give the gateway a **direct** Postgres connection: a transaction-pooling proxy
  (PgBouncer in transaction mode) breaks session locks. With `leaderLock.enabled=false` the chart refuses `replicaCount > 1` and
  autoscaling, and uses `Recreate` so a rollout never overlaps two worker sets.
* **Migrations run inside the app, before the port opens.** `/healthz` (liveness) and `/readyz` (Postgres check) are used for
  probes, with a generous startup probe. Nothing serialises migrations across replicas: two pods starting together on a database
  that needs a migration can race. Roll out one pod first (or scale to 1) when a release adds a migration.
* **Key material is read from files**, mounted from Secrets under `/run/secrets/...` (`PAYOUT_SIGNER_KEY_FILE`,
  `SWEEP_GAS_KEY_FILE`, `TREASURY_WARM_KEY_FILE`). Each worker is off until enabled, and the chart fails to render if a worker is
  enabled without its key.
* **Alerts**: `alerts.webhookSecret` / `alerts.pagerdutySecret` set `ALERT_WEBHOOK_URL` / `ALERT_PAGERDUTY_ROUTING_KEY`. The gateway has no SNS
  setting today; the Terraform `alerts` module provides the SNS topic, a publish policy and CloudWatch alarms for whoever builds
  that sink, and its log-pattern alarms match the gateway's current log lines.

## 10. Smoke checks

| Check | Command | Expect |
|---|---|---|
| each node up, backups on | `kubectl logs statefulset/mpc-nodeN -c mpc-node` | `mutual TLS required from every caller`, `key-share backups on`, node policy digest |
| coordinator sees the cluster | `curl -s http://<signer>:8080/mpc/status` | the three nodes reachable (response shape not checked here) |
| api-gateway ready | `curl -s http://<api-gateway>:3000/health/ready` | `{"status":"ready",...}` |
| keys backfilled | `POST /admin/custody/keys/backfill` (admin key) | `failed: []` |
| a signature verifies | sign a test transfer through the api-gateway on a test network | address recovers to the workspace's key address |
| gateway up | `curl -s http://<gateway>:8020/readyz` | `{"status":"ready"}` |
| assets verified | `GET /assets` (admin key) | each enabled token `available` |
| exactly one leader | gateway logs, `[leader]` lines across replicas | one replica reports leadership |
| treasury (if enabled) | `GET /treasury/status` | no shortfall, wallets funded |
| alerts reach a human | trigger a test alert / check the sink | arrives |
| backup restores | the drill in `disaster-recovery.md` (`mpc-node backup-inspect` / `dr-drill.sh`) | passes with *k* officers |

## What each chart sets

**mpc-node** (per node; `infra/helm/mpc-node`): see the table in that chart's README. In short `MPC_ENV`, `MPC_SEAL_PROVIDER`,
`VAULT_ADDR`, `MPC_VAULT_KEY`, `MPC_VAULT_TRANSIT_MOUNT`, `VAULT_NAMESPACE`, `VAULT_CACERT`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`,
`VAULT_APPROLE_MOUNT` or `VAULT_TOKEN_FILE`; `MPC_KMS_KEY_ID`, `AWS_REGION`; `MPC_TLS_CA_FILE`, `MPC_TLS_CERT_FILE`, `MPC_TLS_KEY_FILE`;
`MPC_NODE_POLICY_FILE`, `MPC_NODE_MAX_VALUE_WEI`; `MPC_BACKUP_RECIPIENTS`, `MPC_BACKUP_S3_BUCKET`, `MPC_BACKUP_S3_PREFIX`,
`MPC_BACKUP_S3_KMS_KEY`, `MPC_BACKUP_DIR`, `MPC_BACKUP_INTERVAL`; flags `-id -data -cluster -listen -policy`.

**OpenFireblocks chart**

| Component | Variables set | Source |
|---|---|---|
| mpc-signer | `PORT`, `MPC_ENV`, `MPC_REQUIRED`, `MPC_CLUSTER_FILE`, `MPC_COORDINATOR_KEY_FILE`, `MPC_TLS_CA_FILE`, `MPC_TLS_CERT_FILE`, `MPC_TLS_KEY_FILE`, `IMMUDB_URL`, `IMMUDB_USER`, `IMMUDB_PASSWORD`, legacy `VAULT_ADDR`, `VAULT_TOKEN` | `mpcSigner.*` |
| api-gateway | `PORT`, `NODE_ENV`, `DATABASE_URL`*, `ADMIN_API_KEY`*, `MPC_SIGNER_URL`, `POLICY_SERVICE_URL`, `ETHEREUM_RPC_SEPOLIA`, `ETHEREUM_RPC_URL`, `ETHEREUM_NETWORK_NAME`, `REDIS_URL`, `TEMPORAL_HOSTPORT`, `TEMPORAL_NAMESPACE`, `MPC_THRESHOLD_SIGNING`, `KEY_BACKFILL_ON_START`, `KEY_BACKFILL_MAX_ATTEMPTS`, `KEY_BACKFILL_FIRST_DELAY_MS`, `FLEET_REFRESH_SAME`, `TX_CONFIRMATIONS`, `TX_STUCK_AFTER_MS`, `RISK_FAIL_CLOSED`, `PG_POOL_MAX` | `apiGateway.*`, `external.*` |
| policy-service | none (listens on `:8081`; `/health`) | `policyService.*` |
| temporal-worker | `TEMPORAL_HOSTPORT`, `TEMPORAL_NAMESPACE`, `POLICY_SERVICE_URL`, `MPC_SIGNER_URL`, `ETHEREUM_RPC_SEPOLIA`, `REQUIRED_CONFIRMATIONS` | `external.*` |

\* from Secrets.

**stablecoin-gateway chart**

| Variables | Source |
|---|---|
| `NODE_ENV`, `LOG_LEVEL`, `PORT` | `env` |
| `POSTGRES_HOST/PORT/DB/USER`, `REDIS_URL`, `UNIFIED_ROUTER_URL` | `global.*` |
| `LEADER_LOCK_ENABLED`, `LEADER_RETRY_MS` | `leaderLock.*` |
| `CORS_ALLOWED_ORIGINS` and any other non-secret setting (`DEPOSIT_MONITOR_CHAINS`, `ASSETS_ENABLED`, `*_RPC_URL`, `PAYOUT_*`, `SWEEP_*`, `REPLENISH_*`, `TREASURY_*`, `FX_*`, `ALERT_ENV`, ...) | `config` |
| `KEY_WRAP_PROVIDER`, `KEY_WRAP_DEK_TTL_SECONDS`; vault: `VAULT_ADDR`, `KEY_WRAP_VAULT_KEY`, `KEY_WRAP_VAULT_MOUNT`, `VAULT_NAMESPACE`, `VAULT_APPROLE_MOUNT`, `VAULT_ROLE_ID`*, `VAULT_SECRET_ID`*; kms: `KEY_WRAP_KMS_KEY_ID`, `AWS_REGION` | `keyWrap.*` |
| `PAYOUT_SIGNER_ENABLED`, `PAYOUT_SIGNER_KEY_FILE`, `PAYOUT_AUTO_SUBMIT` | `payout.*` |
| `SWEEP_ENABLED`, `SWEEP_TREASURY_ADDRESS`, `SWEEP_GAS_KEY_FILE` | `sweep.*` |
| `TREASURY_MANAGER_ENABLED`, `TREASURY_WARM_KEY_FILE`, `TREASURY_COLD_ADDRESS` | `treasury.*` |
| `ALERT_WEBHOOK_URL`*, `ALERT_PAGERDUTY_ROUTING_KEY`* | `alerts.*` |
| `POSTGRES_PASSWORD`*, `INTERNAL_WEBHOOK_SECRET`*, `VALID_API_KEYS`*, `MERCHANT_API_KEYS`* | the Secret named by `secretRef` (envFrom) |

\* from Secrets.

## Secrets that must exist beforehand

| Secret / parameter | Created by | Consumed as | Where |
|---|---|---|---|
| node seal key (KMS key / Vault transit key) | Terraform `kms-keys` / Vault | `MPC_KMS_KEY_ID` / `MPC_VAULT_KEY` | each node's domain |
| node AppRole (`role-id`, `secret-id`) | Vault, then `kubectl create secret` | `VAULT_ROLE_ID`, `VAULT_SECRET_ID` | each Vault-backed node's cluster |
| node mTLS cert (`tls.crt`, `tls.key`, `ca.crt`), CN = node id | `mpc-node pki-issue` or cert-manager | `MPC_TLS_*` | each node's cluster |
| Vault CA (optional) | operator | `VAULT_CACERT` | each Vault-backed node's cluster |
| recovery public keys (`fprec1:...`) | `mpc-node backup-keygen` ceremony | `MPC_BACKUP_RECIPIENTS` | node values (public) |
| backup bucket + KMS key + pruner role | Terraform `mpc-backup-bucket` | `MPC_BACKUP_S3_BUCKET`, `MPC_BACKUP_S3_KMS_KEY` | per node |
| `cluster.json` (public) | `mpc-node cluster` | ConfigMap | every node and the coordinator |
| coordinator key (`coordinator.key`) | `mpc-node coordinator-key` | `MPC_COORDINATOR_KEY_FILE` | platform cluster (`mpc/coordinator-key`) |
| coordinator mTLS cert, CN = `coordinator` | `pki-issue` or cert-manager | `MPC_TLS_*` | platform cluster (`mpc/coordinator-tls`) |
| `openfireblocks/database-url`, `openfireblocks/admin-api-key` | Terraform container, value out of band | `DATABASE_URL`, `ADMIN_API_KEY` | platform cluster |
| `stablecoin/postgres-password`, `stablecoin/admin-api-keys`, `stablecoin/merchant-api-keys` | container + value | `POSTGRES_PASSWORD`, `VALID_API_KEYS`, `MERCHANT_API_KEYS` | platform cluster |
| `internal-webhook-secret` | existing `secrets` module | `INTERNAL_WEBHOOK_SECRET` | platform cluster |
| `stablecoin/payout-signer-key` | container + value | file `PAYOUT_SIGNER_KEY_FILE` | platform cluster |
| `stablecoin/sweep-gas-key` | container + value | file `SWEEP_GAS_KEY_FILE` | platform cluster |
| `stablecoin/treasury-operating-key` | container + value | file `TREASURY_WARM_KEY_FILE` | platform cluster |
| `stablecoin/key-wrap-vault-approle` | container + value (Vault only) | `VAULT_ROLE_ID`, `VAULT_SECRET_ID` | platform cluster |
| deposit-key KMS key | Terraform `kms-keys` | `KEY_WRAP_KMS_KEY_ID` | platform account |
| `/forgepay/<env>/stablecoin/treasury-cold-address` (SSM, public) | Terraform, value out of band | `TREASURY_COLD_ADDRESS` | platform account |
| alert webhook URL / PagerDuty routing key | operator | `ALERT_WEBHOOK_URL`, `ALERT_PAGERDUTY_ROUTING_KEY` | platform cluster |

## CI

* `.github/workflows/forgepay-custody-ci.yml` (PRs and pushes): gateway `tsc` + `vitest`; gateway migrations on an empty Postgres;
  api-gateway build + jest; `go vet` + `go test -short` for the signer; `helm lint` + `helm template` for every chart;
  `terraform fmt -check` + `validate` for modules and examples; `govulncheck` and `npm audit` (**non-blocking for now**);
  gitleaks (blocking).
* `.github/workflows/forgepay-custody-nightly.yml` (02:17 UTC and manual): the full signer integration
  (`go test ./internal/mpc/ -timeout 60m`, real cryptographic nodes) and the gateway end-to-end
  (`scripts/multi-asset-e2e.cjs` on Postgres + ganache).

## Validation status

Run in the environment that produced these files: `helm lint` / `helm template` on every chart (the three `values-nodeN.yaml`
and the init and preflight phases for mpc-node); `terraform fmt -check` and `terraform validate` (AWS provider 5.82.2) on the new
modules, the secrets module and the example; `actionlint` (with shellcheck) and `yamllint` on the workflows; gateway `tsc`,
`vitest`, the migrations on an empty Postgres, api-gateway build + jest, `go vet` and `go test -short`.
**Not run:** anything on a real cluster, AWS account or Vault; the container images; `govulncheck` (its vulnerability database was
unreachable); the umbrella chart `forgepay-stack` (its Bitnami dependencies were unreachable); `terraform validate` of the `eks` module
and the root module (they need providers that could not be downloaded).
