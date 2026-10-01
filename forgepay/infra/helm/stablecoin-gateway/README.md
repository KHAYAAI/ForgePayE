# stablecoin-gateway chart

Deploys the ForgePay stablecoin gateway (`services/stablecoin-gateway`). The full runbook, with the environment-variable and
secret tables, is `docs/DEPLOYING_THRESHOLD_CUSTODY.md`; example values are in `ci/production-values.yaml`.

## Replicas: read this before changing `replicaCount`

Every gateway process serves HTTP **and** runs background workers: the settlement poller always, and the payout worker, sweeper and
treasury manager when enabled. Those workers move money, so they must run in exactly one place at a time.

| Setting | Behaviour |
|---|---|
| `leaderLock.enabled: true` (default; env `LEADER_LOCK_ENABLED`) | replicas compete for a Postgres **session-level advisory lock**; the holder runs the workers, the others serve HTTP and wait, and one takes over within `LEADER_RETRY_MS` (`leaderLock.retryMs`, app default 5000) when the leader's connection dies. `replicaCount > 1` and `autoscaling` are allowed, rollouts are `RollingUpdate`. |
| `leaderLock.enabled: false` | the chart **refuses to render** with `replicaCount > 1` or `autoscaling.enabled`, and uses `Recreate` so a rollout never overlaps two worker sets. |

* **`replicaCount` defaults to 1 and autoscaling is off.** The chart cannot tell whether the image you deploy contains the leader
  election (`src/lib/leader.ts`); raise the count only once it does. (Earlier versions of this chart defaulted to 3 replicas with an HPA,
  which would have run the workers three times.)
* The lock needs a **direct** Postgres connection. A transaction-pooling proxy (PgBouncer in transaction mode) would release or share it.
* Only the leader does the money-moving work, so extra replicas add HTTP capacity and failover, not worker throughput.
* The umbrella chart (`forgepay-stack`) and the staging values still set `stablecoinGateway.replicaCount: 2` / `1`; with the leader lock on, 2 is
  fine once the image supports it.

## Migrations

The application runs its migrations at start-up, before the port opens (`runMigrations`), so there is no migration Job. The startup probe
allows time for that. Migrations are not serialised across replicas: when a release adds a migration, start one pod first (scale to 1, or roll out
one pod at a time) so two pods do not race on the same migration.

## Secrets and files

* `secretRef` (envFrom) must hold `POSTGRES_PASSWORD` and `INTERNAL_WEBHOOK_SECRET` (the service refuses to start without them) and, in
  production, `VALID_API_KEYS`. `MERCHANT_API_KEYS` is optional. The chart never renders a Secret.
* Signing and treasury keys are mounted as **files** from Secrets (`payout.keySecret`, `sweep.gasKeySecret`, `treasury.operatingKeySecret`) and
  the matching `*_KEY_FILE` variable is set; each worker is off until enabled and the chart fails if it is enabled without its key.
* `keyWrap.*` selects Vault or AWS KMS for deposit-key wrapping (IRSA annotation via `serviceAccount.annotations` for KMS).
* `config` is a free-form map of non-secret variables (`CORS_ALLOWED_ORIGINS` is **required in production**: the application, not the chart, enforces it).

## Compatibility

`env` may be a map (this chart's form) or a list of `{name, value}` entries (the form some staging values files use). The service port
(`env.PORT`, default 8020) is the container port; probes use the named port.
