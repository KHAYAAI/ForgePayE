# Key-share backup and disaster recovery

A threshold key survives the loss of up to `n − (t+1)` nodes. Lose more — two of three hosts, a
cloud account, a seal key nobody can read any more — and the key, and everything it controls, is
gone unless there is a backup. This is that backup, and the drill that proves it works.

## What is backed up, and how it is protected

Each node writes an **encrypted backup of its own state**: its newest share of every key, its
identity key, its policy ledger, its audit log and a copy of the cluster file. The backup is
encrypted to a **recovery key that no node holds**:

- `mpc-node backup-keygen -k 3 -n 5 -out DIR` makes an X25519 recovery key, splits its private half
  among *n* officers with Shamir secret sharing (any *k* recover it), and writes the public half to
  `DIR/recipient.txt`. Hand each `officer-N.share` to a different person on separate media, then
  delete the files from the machine. **The private key is not stored anywhere else.**
- Nodes are given only the public half (`MPC_BACKUP_RECIPIENTS=fprec1:…`). Stealing a node, its
  backup bucket, or both yields ciphertext. Decrypting needs *k* officers together.
- Each backup is AES-256-GCM under a fresh key, wrapped to every recipient; the header (node, time,
  key epochs) is authenticated, so a backup cannot be relabelled as another node's or a newer epoch.
- Restoring re-seals the shares under a **new** seal key. The old seal key (and the host it lived
  on) is not needed — that is the point.

Turn it on per node:

```
MPC_BACKUP_RECIPIENTS=fprec1:…            # one or more public recovery keys
MPC_BACKUP_S3_BUCKET=… MPC_BACKUP_S3_PREFIX=mpc  [MPC_BACKUP_S3_KMS_KEY=…]    # or MPC_BACKUP_DIR=/mnt/…
MPC_BACKUP_INTERVAL=6h
```

`MPC_ENV=production` **refuses to start** a node without backups configured. Backups run at start-up,
about two seconds after every key generation, reshare commit and share retirement, and on the
interval. Each one is read back and checked before it counts. A failed or stale backup shows in
the node's `/v1/health`, in `mpc-node`'s audit log (`backup_failed`), and as a **Backup** column on
the console's Keys page (*none / failing / behind / current*).

Put the backups where losing the node's host does not lose them — a bucket in a **different cloud
account**, versioned, with a policy that lets only a pruning role delete. `infra/terraform/modules/mpc-backup-bucket` is the Terraform for it (not yet applied to any account).

## Rotation and old backups

A reshare destroys the old shares on the nodes. A backup of an old share would undo that: steal it
plus other nodes' old shares and an attacker holds a quorum of a retired epoch. So after every
retirement each node **deletes its own earlier backups that hold superseded shares** (keeping one
earlier backup at the *same* epochs as a fallback). `TestReshareDropsSupersededBackups` proves it.

What this does not cover: backups already copied elsewhere (a bucket version history, a snapshot) are
outside the node's reach. Keep the bucket's versioning lifecycle short and expire noncurrent versions.

## The restore drill — do it before launch, then every quarter and after every reshare

```
scripts/dr-drill.sh BACKUP_DIR CLUSTER_FILE officer-1.share,officer-3.share,officer-4.share
```

It touches nothing live. It decrypts every backup with the key rebuilt from the officers' shares,
verifies each share (it belongs to its key and epoch, reproduces its address, names that node in
its committee), reports per key whether enough shares **of one epoch** are present to sign, and
restores each node's newest backup into scratch space under a new seal key, checking the restored
identity matches the cluster file. Non-zero exit if anything is unrecoverable. Record the result and
who attended. A drill that has never been run is not a backup.

`TestDisasterRecovery` is the same thing end to end against real nodes: three nodes, two destroyed
with their disks and seal keys, signing refused, both restored from backups onto new seal keys,
signing works and the address is unchanged.

## A real disaster

1. **Stop and assess.** Which nodes are gone? Run `backup-inspect` against the backup store to see
   what can be recovered *before* touching anything.
2. **Assemble *k* officers.** They bring their share files; the recovery key exists only in memory of
   the commands below.
3. **Provision replacement hosts** with a new seal key (Vault transit / KMS key for that node id).
4. **Restore each lost node:**
   ```
   mpc-node backup-restore -in <newest backup of that node> -shares s1,s2,s3 -id nodeN -data /new/data/dir
   ```
   (`MPC_SEAL_PROVIDER` etc. as for a normal start.) It refuses a non-empty directory.
5. **Check the epoch.** The restore report lists each key's epoch. If the surviving nodes are at a newer epoch (a reshare happened after the backup), the restored share is **stale**: it cannot sign with the survivors. Use the newest backup (it should be current — backups follow every reshare) or, if the surviving nodes are all gone too, restore a full quorum from backups of the same epoch (`backup-inspect` says which).
6. **Start the nodes, run `mpc-node preflight`, sign a test transaction** with a throwaway amount, and confirm the address is the one you expect.
7. **Re-establish backups** and make a fresh one; then **rotate** (reshare) the key, because the recovery event may have exposed shares.

## What this does not protect you from

- **Losing more than *n − k* officer shares.** Every backup becomes unreadable permanently. Pick *k* and *n* so that a plausible set of departures cannot do that, and replace officers' shares by re-running `backup-keygen` and re-encrypting (new recipient on the nodes; old backups age out).
- **All backups and all nodes lost in the same event.** Different account, different region.
- **A restored stale pair is a valid epoch quorum.** If someone restores two *old* backups they can sign as of that epoch, until the next reshare supersedes it. Treat backup-store read access + *k* officers as equal in power to the key itself.
- **Bugs.** The drill is the defence. Run it.
