# Recovery officers: setup ceremony and restore drill

**What is built and tested:** the software for both (protected shares, per-officer integrity check, the drill itself, an
audit record). **What cannot be built:** the officers. Real people, on real days, holding real media, must do it. Until that has
happened, the key-share backups are untested in the only way that matters.

Terms: the *recovery key* decrypts every node's backups. It is split among *n* officers; any *k* together rebuild it. Nodes hold
only the public half. Pick *k* and *n* so that losing or losing contact with a plausible number of officers cannot lock you out
(for example 3 of 5), and so that no two people who could collude (same team, same manager) hold enough to reach *k* between them.

## Roles

| | |
|---|---|
| Officers (n) | Each holds one share, on their own media, protected by their own passphrase. From at least three different teams or companies |
| Facilitator | Runs the commands. Holds no share. Never sees a passphrase |
| Witness | Independent of the facilitator and officers; watches, signs the printed record |

## Setup ceremony (once, then after any officer change)

On a clean, offline machine (booted from trusted media, no network), facilitator running, officers and witness present:

1. `mpc-node backup-keygen -k 3 -n 5 -out ./rec`. This prints the **recipient** (public) and writes `recipient.txt` and
   `officer-1.share … officer-5.share`. The recipient goes to every node as `MPC_BACKUP_RECIPIENTS`.
2. **Each officer, one at a time, at the keyboard**, protects their own share so nobody else ever learns the passphrase:
   `mpc-node backup-share-protect -in rec/officer-N.share -out officer-N.share.enc` (types a 12+ character passphrase twice; the
   tool checks the protected copy reads back). The officer then copies `officer-N.share.enc` to **their own** media.
3. Facilitator deletes the plain `officer-N.share` files and **`shred`s/wipes the machine's working directory**; the machine is
   then wiped or destroyed. The recovery key's private half existed only in this machine's memory and in the shares.
4. **Each officer checks their own media** on a different machine: `mpc-node backup-share-check -in officer-N.share.enc`. It
   prints their slot and the recovery-key fingerprint (all officers should see the same fingerprint) without needing anyone
   else. Officers record the fingerprint; the facilitator records the recipient.
5. Each officer stores their media in a different secure place and has a second copy in another place. Record who holds what.
   A passphrase is memorised or kept separately from the media (a safe, a password manager the officer controls); never with it.

## Restore drill (before launch; then every quarter; and after every officer change or reshare)

**Preconditions:** backups exist for every node (`GET /v1/health` on each node shows `backup.coversCurrentShares: true`).

1. At least *k* officers, a facilitator and a witness, on a clean machine. Copy the nodes' backup files (never the live nodes) to it.
2. Run, with each present officer typing their own passphrase when asked (the prompt is on the terminal with echo off):
   ```
   mpc-node backup-inspect -in ./backups -shares officer-1.share.enc,officer-3.share.enc,officer-4.share.enc \\
       -record drill-$(date +%F).json -officers "A. Officer, B. Officer, C. Officer" -witness "W. Witness"
   ```
   It rebuilds the recovery key, decrypts **every** backup, verifies every share (belongs to its key and epoch, reproduces the
   key's address, names the node in its committee), and reports per key whether enough shares of one epoch exist to sign. It
   writes nothing to any node.
3. Then prove a restore, not just a read: `scripts/dr-drill.sh BACKUP_DIR CLUSTER_FILE SHARES` restores each node's newest
   backup into scratch space under a new seal key and checks the identity matches the cluster file.
4. **The record** (`drill-DATE.json`) holds the date, the officers and witness as typed, which share slots were used, the SHA-256
   of every backup tested, the per-key outcome, pass/fail, and a seal over its own contents so a later edit is detectable. Print
   it; the witness and each officer sign the paper. File both. A drill with `keysRecovered: 0` is **not a pass** (the backups held no shares).
5. **Then** have the officers prove the negative: with only *k−1* shares, `backup-inspect` must fail. (It is tested to.)
6. Wipe the machine.

If the drill fails: stop, find out why before anything else, and do not rely on the backups until a drill passes.

## Limits you should know

- The drill record proves what the software saw. It does not prove the named people were present; the witness's signature does.
- Shares protected by passphrases are only as good as the passphrases and the officers' care. Lose *n−k+1* shares (or their
  passphrases) and every backup is permanently unreadable.
- Reshares and node changes change what backups hold. Re-run the drill after them.
- Rotate officers by running the setup ceremony again (new recipient on the nodes; old backups age out as new ones replace them).
