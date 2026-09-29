# OpenPrivy — Disaster Recovery Runbook

Scope: the stateful tier (PostgreSQL, Redis) and the encryption master key. The
backend itself is stateless — pods are recreated from the ECR image, so recovery
there is just a redeploy.

## Targets

| | Target | Basis |
|---|---|---|
| **RPO** (data loss) | ≤ 5 min | RDS Multi-AZ sync replica + automated backups |
| **RTO** (time to restore) | ≤ 60 min | snapshot restore + redeploy |

Redis is a cache (rate-limit counters, sessions). Losing it is non-fatal: limits
reset and users re-authenticate. Do not treat Redis as a system of record.

## The one thing that makes backups useless if lost

Wallet private keys are stored **encrypted with per-user keys derived from the
Secrets Manager master key**. A database restore only yields usable wallets if
the **same master key** is still in Secrets Manager. Therefore:

- The master-key secret has its own protection: **never delete it**, enable
  Secrets Manager **rotation with re-encryption** (not blind rotation), and
  replicate it to a second region.
- A DB restore + a rotated-away master key = permanently undecryptable wallets.
  Test decrypt after every restore drill.

## Scenario A — RDS instance failure (most common)

Multi-AZ fails over automatically (~1–2 min). Action: confirm the new writer,
confirm the app reconnected (`/health` 200, error rate normal). No data loss.

## Scenario B — data corruption / bad migration / accidental delete

1. Identify a good point in time (before the event).
2. **RDS point-in-time restore** to a *new* instance (console/CLI). Do not
   overwrite the live instance.
3. Repoint `DATABASE_URL` (Secrets Manager / k8s Secret) at the restored writer.
4. `kubectl rollout restart deployment/backend -n openprivy`.
5. Verify: row counts, and **decrypt one wallet** to confirm the master key still
   matches.

## Scenario C — full region / logical restore from dump

Uses the portable logical backup (`scripts/db-backup.sh` → S3, SSE-AES256):

```bash
TARGET_URL=postgres://…/openprivy_restore DUMP=openprivy-<ts>.dump \
  scripts/db-restore.sh
```

The restore script prints core-table row counts. Then repoint + redeploy as above.

**This round-trip is tested**: `db-backup.sh` (pg_dump custom format) →
`db-restore.sh` (pg_restore --clean into a fresh DB) was verified to reproduce
identical row counts, with `encryptedPrivateKey` values intact.

## Scenario D — encryption master key compromise

1. Generate a new 32-byte master key; store as a new Secrets Manager version.
2. **Re-encrypt every wallet** with `EncryptionService.rotateKey(old, new)`
   BEFORE retiring the old version (old ciphertext is undecryptable under the new
   key otherwise). *(Batch rotation tooling is a tracked follow-up — the
   primitive exists; do not rotate the secret without it.)*
3. Rotate JWT_SECRET too (invalidates outstanding sessions).

## Quarterly DR drill checklist

- [ ] PITR restore to a scratch instance completes within RTO.
- [ ] Logical `db-restore.sh` reproduces row counts.
- [ ] **Decrypt a wallet from the restored DB** using the live master key.
- [ ] Backend reconnects and serves `/health` 200 against the restored DB.
- [ ] Redis loss tolerated (limits reset, logins recover).
- [ ] Findings logged; runbook updated.
