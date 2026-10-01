#!/usr/bin/env bash
# Restore drill: prove the backups can bring the nodes back, WITHOUT touching the live cluster.
#
#   scripts/dr-drill.sh BACKUP_DIR CLUSTER_FILE SHARE_FILE[,SHARE_FILE...]
#
# 1. decrypts every backup with the recovery key rebuilt from the officer shares and checks each share
# 2. says, per key, whether enough shares of one epoch are present to sign again
# 3. restores each node's newest backup into a scratch directory under a brand-new seal key and checks
#    the restored identity matches the cluster file
# Exit status is non-zero if anything is unrecoverable. Run it quarterly and after any reshare,
# with real officers holding real shares, and record the result.
set -euo pipefail
BACKUPS="${1:?backup directory}"; CLUSTER="${2:?cluster file}"; SHARES="${3:?officer share files, comma-separated}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${MPC_NODE_BIN:-}"
if [ -z "$BIN" ]; then BIN="$(mktemp -d)/mpc-node"; (cd "$HERE/services/mpc-signer" && go build -o "$BIN" ./cmd/mpc-node); fi
SCRATCH="$(mktemp -d)"; trap 'rm -rf "$SCRATCH"' EXIT

echo "== 1-2. decrypt and plan =="
"$BIN" backup-inspect -in "$BACKUPS" -shares "$SHARES"

echo; echo "== 3. restore each node's newest backup into scratch space =="
failed=0
for dir in "$BACKUPS"/*/; do
  node="$(basename "$dir")"
  newest="$(ls -1 "$dir"*.mpcbackup | sort | tail -1)"
  dest="$SCRATCH/$node"
  if env MPC_SEAL_PROVIDER=file "$BIN" backup-restore -in "$newest" -shares "$SHARES" -id "$node" -data "$dest" > "$SCRATCH/$node.out" 2>&1; then
    want="$(python3 -c "import json,sys;print([n['x25519_pub'] for n in json.load(open('$CLUSTER'))['nodes'] if n['id']=='$node'][0])")"
    got="$(python3 -c "import json;print(json.load(open('$dest/identity.json'))['x25519_pub'])")"
    if [ "$want" = "$got" ]; then echo "ok    $node restored; identity matches the cluster file"; else echo "FAIL  $node restored but its identity is not the one in the cluster file"; failed=1; fi
  else
    echo "FAIL  $node: $(tail -1 "$SCRATCH/$node.out")"; failed=1
  fi
done
[ "$failed" = 0 ] && echo && echo "restore drill passed" || { echo; echo "restore drill FAILED"; exit 1; }
