# mpc-node — one FORGE threshold-signing node

This chart deploys **ONE** signing node (`mpc-node`, built from `services/openfireblocks/services/mpc-signer/Dockerfile.node`).
A 2-of-3 cluster is **three separate installs of this chart**, not one install with three replicas.

## Install it once per node, in a different trust domain

The point of the cluster is that no single party can ever reach `t+1` shares. That only holds if the nodes do not share
a failure or an administrator, so each node should have its **own**:

| | node1 | node2 | node3 |
|---|---|---|---|
| Kubernetes cluster / account | AWS account A, EKS | AWS account B, EKS | operator C's own cluster |
| Seal key | AWS KMS key in account A | AWS KMS key in account B | operator C's Vault transit key |
| Operators | team A | team B | team C |
| Policy file | decided by A | decided by B | decided by C |
| Backup bucket / volume | account A | account B | operator C's array |

`values-node1.yaml`, `values-node2.yaml` and `values-node3.yaml` are three such installs (two KMS, one Vault; two with
cert-manager, one with a hand-issued certificate; S3 and directory backups). They are examples with placeholder
accounts, hosts and addresses; copy and edit them, run each against its **own** kube-context:

```bash
helm upgrade --install mpc-node1 infra/helm/mpc-node -n mpc --create-namespace --kube-context node1-cluster \
  -f infra/helm/mpc-node/values-node1.yaml --set-file cluster.json=cluster.json
```

The domain label (`node.domain`) is a *declaration*: the software refuses a topology that visibly puts `t+1` nodes in
one domain, but it cannot prove a label is true. Make it true. Installing all three releases into one namespace of one
cluster is possible and is only appropriate for development.

## Lifecycle: three phases

The node needs an identity before it can run, and the cluster file needs every node's identity before any can run, so
a node is installed in phases:

1. **init** — creates the identity key (sealed under the seal key, which Vault/KMS wraps) and exports the *public* part.
   ```bash
   helm upgrade --install mpc-node1 <chart> -f values-node1.yaml --set init.enabled=true --set serve.enabled=false
   kubectl wait --for=condition=complete job/mpc-node1-init --timeout=10m
   kubectl logs job/mpc-node1-init -c export-identity > node1.identity.json
   ```
   `mpc-node init` refuses to run twice on the same data. Send `node1.identity.json` (public) to whoever assembles the
   cluster file: `mpc-node cluster -threshold 1 -coordinator-pub <hex> -out cluster.json node1.identity.json node2.identity.json node3.identity.json`.
2. **preflight** — with `cluster.json`, the certificate, the policy and the backup settings in place, but the node not
   yet running, run the check as a Job:
   ```bash
   helm upgrade mpc-node1 <chart> -f values-node1.yaml --set-file cluster.json=cluster.json \
     --set init.enabled=false --set serve.enabled=false --set preflight.job.enabled=true
   kubectl logs job/mpc-node1-preflight      # `ready` and exit 0, or the list of what is wrong
   ```
   This is `mpc-node preflight -id X -data DIR -cluster FILE`: it prints what production start-up would refuse and what
   it merely dislikes (topology, https URLs, seal key unwrap against the real Vault/KMS, certificate name and expiry,
   policy, data-directory permissions). The data volume is ReadWriteOnce, so the Job and the node cannot run at once.
3. **serve** — start the node. The StatefulSet repeats the preflight as an init container on every start, so a node
   whose certificate expired or whose Vault is unreachable stays down with the reason in `kubectl logs ... -c preflight`.
   ```bash
   helm upgrade mpc-node1 <chart> -f values-node1.yaml --set-file cluster.json=cluster.json
   ```

## What the chart sets

Everything below is also summarised, per chart, in `docs/DEPLOYING_THRESHOLD_CUSTODY.md`.

| Value | Environment variable / flag | Notes |
|---|---|---|
| `node.id` | `-id` | must equal the certificate CN and the `cluster.json` entry |
| `node.env` | `MPC_ENV` | `production` by default: refuses file/env seal keys, plain HTTP, one-domain topologies, no backups |
| `node.dataDir`, `persistence.*` | `-data` (volume mounted at `/data`) | sub-directory `/data/node`, because `mpc-node` requires its data directory to be mode 0700 and a volume root with `fsGroup` is not |
| `node.domain`, `node.url` | `init -domain`, `init -url` | init only |
| `seal.provider` | `MPC_SEAL_PROVIDER` | `vault` or `awskms` |
| `seal.vault.addr`, `.namespace`, `.transitMount`, `.key`, `.caCertSecret` | `VAULT_ADDR`, `VAULT_NAMESPACE`, `MPC_VAULT_TRANSIT_MOUNT`, `MPC_VAULT_KEY`, `VAULT_CACERT` | key defaults to `mpc-node-<id>` |
| `seal.vault.auth=approle` | `VAULT_ROLE_ID`, `VAULT_SECRET_ID` (from a Secret), `VAULT_APPROLE_MOUNT` | policy: `deploy/mpc/vault-policy.example.hcl` |
| `seal.vault.auth=agent` | `VAULT_TOKEN_FILE=/vault/secrets/token` + Vault Agent Injector annotations | Kubernetes auth through the injector (pre-populate only); see below |
| `seal.awskms.keyId`, `.region` | `MPC_KMS_KEY_ID`, `AWS_REGION` | give the key **ARN**; IRSA via `serviceAccount.annotations` |
| `tls.*` | `MPC_TLS_CA_FILE`, `MPC_TLS_CERT_FILE`, `MPC_TLS_KEY_FILE` | mounted from a Secret or a cert-manager `Certificate` (CN = node id) |
| `policy.json` | `MPC_NODE_POLICY_FILE` / `-policy` | ConfigMap, reloaded by the node when edited; the coordinator cannot change it |
| `cluster.json` | `-cluster` | ConfigMap, reloaded by the node when edited |
| `node.maxValueWei` | `MPC_NODE_MAX_VALUE_WEI` | older single cap |
| `backup.recipients` | `MPC_BACKUP_RECIPIENTS` | public recovery keys (`fprec1:...`), comma-joined |
| `backup.s3.bucket`, `.prefix`, `.kmsKey` | `MPC_BACKUP_S3_BUCKET`, `MPC_BACKUP_S3_PREFIX`, `MPC_BACKUP_S3_KMS_KEY` | terraform: `modules/mpc-backup-bucket` |
| `backup.dir.*` | `MPC_BACKUP_DIR` | a **separate** volume; choose S3 *or* dir, not both |
| `backup.interval` | `MPC_BACKUP_INTERVAL` | e.g. `6h` |

The backup variables are taken from `internal/mpc/backup_env.go`, which was still being written when this chart was
made. Re-check the names against that file before relying on them.

### Seal key: Vault or KMS

* **AWS KMS** — the key lives in the node's own account (terraform `modules/kms-keys`, one call per node with a provider
  alias). The node's IRSA role may only `kms:GenerateDataKey` and `kms:Decrypt` with the encryption context
  `mpc-node = <node id>`. Note that `mpc-node seal-check -provider awskms` uses the context `mpc-node = seal-check`, so run it
  with the module's `allow_seal_check_context = true` (the default) and tighten afterwards.
* **Vault** — a transit key per node and an AppRole that can use only that key. `seal.vault.auth: agent` instead uses the
  Vault Agent Injector: the chart adds `vault.hashicorp.com/agent-inject-token`, `agent-init-first` and
  `agent-pre-populate-only`, so a token file exists before the node starts and no sidecar stays running. The node itself has no
  Kubernetes-auth client; this works only through the injector, and has **not** been run against a real injector.

### Certificates

A node certificate's common name is its node id and it needs both server and client auth (`mpc-node pki-issue` produces
that). With `tls.certManager.enabled` the chart creates the `Certificate`; the `issuerRef` must point at a CA that
**every** node's operators trust, i.e. the cluster's shared private CA. Keeping that CA's key inside one operator's
cluster hands that operator the ability to mint certificates for every node, so decide who holds it
(`mpc-node pki-init`; nodes need only `ca.pem`). Renewed certificate files are picked up without a restart.

## Security posture

* **Pod**: non-root (65532, the distroless `nonroot` user), read-only root filesystem, all capabilities dropped, no
  privilege escalation, `RuntimeDefault` seccomp, no service-account token unless Vault Agent needs it. `/tmp` is a small
  `emptyDir`; the only writable persistent path is the data volume (and the backup volume, if used).
* **Network**: a `NetworkPolicy` admits only `networkPolicy.ingress.from` (put the coordinator and the other nodes
  there) on the node port, and allows egress only to DNS, `networkPolicy.egress.peers` (other nodes), the key service, and
  AWS HTTPS when KMS or an S3 sink is configured. **With `ingress.from` empty nothing can connect.** Peers in other
  clusters are normally reached through a layer-4 load balancer (`service.type: LoadBalancer`); TLS must terminate *at the
  node* (the node requires a client certificate), so never use a TLS-terminating balancer.
* **PodDisruptionBudget**: `minAvailable: 1` on a one-pod StatefulSet blocks voluntary eviction (node drains, automatic
  cluster upgrades) until an operator removes it or sets `pdb.maxUnavailable: 1`. That is deliberate for a node that may be
  mid-ceremony, and it will hang an unattended upgrade; coordinate node upgrades.
* **Probes**: TCP only. The node demands a client certificate on every connection, which the kubelet cannot present, so
  HTTP probes against `/v1/health` would always fail. A TCP probe proves the listener is up, not that signing works.
* **Data volume**: `helm.sh/resource-policy: keep` — `helm uninstall` leaves the sealed shares in place on purpose.

## Resources

Key generation is CPU-bound (Paillier safe primes and pre-parameters). The full integration test of three real nodes takes
about ten minutes on four cores, and a node that has just taken part in a ceremony may need a minute before its next one.
The defaults request 2 CPUs and 1 GiB, with a 2 GiB memory limit and **no CPU limit**: throttling would stretch key
generation and resharing until the coordinator gives up. These numbers are estimates, not measurements; size them from a
real run in your environment.

## Validated and not validated

Rendered and linted with `helm lint` / `helm template` for all three example values files and for the init and preflight
phases. **Not** installed on a real cluster: the StatefulSet start-up, IRSA, the Vault Agent Injector, cert-manager, the
NetworkPolicy behaviour and the load-balancer annotations have not been exercised. The container image has not been built
here.
