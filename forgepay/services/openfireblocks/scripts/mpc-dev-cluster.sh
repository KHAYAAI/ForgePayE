#!/usr/bin/env bash
# Run a 2-of-3 signing cluster on this machine: three separate mpc-node
# processes, each with its own data directory and its own seal key.
#
# This is for development. Everything shares one host, so it is ONE trust
# domain: whoever can read this machine can read all three shares. The signer
# and the console both report that. Production puts each node on separate
# infrastructure, with MPC_NODE_SEAL_KEY supplied from Vault or a KMS.
#
#   scripts/mpc-dev-cluster.sh [DIR]        # default DIR: ./.mpc-dev
#
# Idempotent: the first run creates identities, the coordinator key and
# cluster.json; every run starts whichever nodes aren't already up.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${1:-$HERE/.mpc-dev}"
BASE_PORT="${MPC_DEV_BASE_PORT:-8101}"
N=3
THRESHOLD=1
BIN="$DIR/bin/mpc-node"

mkdir -p "$DIR/bin" "$DIR/logs"
if [ ! -x "$BIN" ] || [ -n "$(find "$HERE/services/mpc-signer" -name '*.go' -newer "$BIN" -print -quit)" ]; then
  (cd "$HERE/services/mpc-signer" && go build -o "$BIN" ./cmd/mpc-node)
fi

if [ ! -f "$DIR/cluster.json" ]; then
  "$BIN" coordinator-key -out "$DIR/coordinator.key" > "$DIR/coordinator.pub"
  ids=()
  for i in $(seq 1 $N); do
    port=$((BASE_PORT + i - 1))
    "$BIN" init -id "node$i" -data "$DIR/node$i" -url "http://127.0.0.1:$port" -domain "dev-local" > /dev/null
    ids+=("$DIR/node$i/identity.json")
  done
  "$BIN" cluster -threshold $THRESHOLD -coordinator-pub "$(cat "$DIR/coordinator.pub")" -out "$DIR/cluster.json" "${ids[@]}"
  echo "created cluster in $DIR"
fi

for i in $(seq 1 $N); do
  port=$((BASE_PORT + i - 1))
  if curl -fs --max-time 2 "http://127.0.0.1:$port/v1/health" > /dev/null 2>&1; then
    echo "node$i: already up on :$port"
    continue
  fi
  # Each node is its own process with its own environment; setsid detaches it.
  setsid nohup "$BIN" serve -id "node$i" -data "$DIR/node$i" -cluster "$DIR/cluster.json" -listen "127.0.0.1:$port" \
    < /dev/null > "$DIR/logs/node$i.log" 2>&1 &
  echo "node$i: started on :$port"
done

echo
echo "coordinator env for the signer:"
echo "  MPC_CLUSTER_FILE=$DIR/cluster.json"
echo "  MPC_COORDINATOR_KEY_FILE=$DIR/coordinator.key"
