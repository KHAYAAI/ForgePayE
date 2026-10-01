#!/usr/bin/env bash
# Run a 2-of-3 signing cluster on this machine: three separate mpc-node
# processes, each with its own data directory and its own seal key.
#
# This is for development. Everything shares one host, so it is ONE trust
# domain: whoever can read this machine can read all three shares. The signer
# and the console both report that, and MPC_ENV=production refuses to start
# this topology. Production puts each node on separate infrastructure.
#
#   scripts/mpc-dev-cluster.sh [DIR]        # default DIR: ./.mpc-dev
#
# Options (environment), each of which makes the dev cluster behave more like
# production for testing:
#   MPC_DEV_TLS=1            mutual TLS between coordinator and nodes, from a private CA in DIR/pki
#   MPC_DEV_SEAL=vault       seal keys wrapped by Vault transit (needs VAULT_ADDR and VAULT_TOKEN)
#   MPC_DEV_POLICY=0         don't write a per-node policy file (default: a modest dev policy)
#   MPC_DEV_BACKUP=1         encrypted key-share backups to DIR/backups, with a recovery key whose
#                            3 officer shares are written to DIR/recovery (DEV ONLY: in production
#                            those go to three different people and are deleted from the machine)
#   MPC_DEV_BASE_PORT=8101
#
# Idempotent: the first run creates identities, the coordinator key and
# cluster.json; every run starts whichever nodes aren't already up, and writes
# DIR/signer.env with what the signer needs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mkdir -p "${1:-$HERE/.mpc-dev}" && cd "${1:-$HERE/.mpc-dev}" && pwd)"
BASE_PORT="${MPC_DEV_BASE_PORT:-8101}"
N=3
THRESHOLD=1
BIN="$DIR/bin/mpc-node"
# A cluster remembers how it was set up. Running the script again with no options keeps that mode
# rather than quietly downgrading a cluster that was moved to mutual TLS or Vault.
if [ -f "$DIR/mode.env" ]; then
  [ -n "${MPC_DEV_SEAL:-}" ]   || MPC_DEV_SEAL=$(sed -n 's/^SEAL=//p' "$DIR/mode.env")
  [ -n "${MPC_DEV_TLS:-}" ]    || MPC_DEV_TLS=$(sed -n 's/^TLS=//p' "$DIR/mode.env")
  [ -n "${MPC_DEV_POLICY:-}" ] || MPC_DEV_POLICY=$(sed -n 's/^POLICY=//p' "$DIR/mode.env")
fi
SEAL="${MPC_DEV_SEAL:-file}"
TLS="${MPC_DEV_TLS:-0}"
POLICY="${MPC_DEV_POLICY:-1}"
printf 'SEAL=%s\nTLS=%s\nPOLICY=%s\n' "$SEAL" "$TLS" "$POLICY" > "$DIR/mode.env"
SCHEME=http; [ "$TLS" = "1" ] && SCHEME=https

mkdir -p "$DIR/bin" "$DIR/logs"
if [ ! -x "$BIN" ] || [ -n "$(find "$HERE/services/mpc-signer" -name '*.go' -newer "$BIN" -print -quit)" ]; then
  (cd "$HERE/services/mpc-signer" && go build -o "$BIN" ./cmd/mpc-node)
fi

# ---- seal keys in Vault ------------------------------------------------------
if [ "$SEAL" = "vault" ]; then
  : "${VAULT_ADDR:?MPC_DEV_SEAL=vault needs VAULT_ADDR}" "${VAULT_TOKEN:?MPC_DEV_SEAL=vault needs VAULT_TOKEN}"
  curl -fsS -X POST -H "X-Vault-Token: $VAULT_TOKEN" -d '{"type":"transit"}' "$VAULT_ADDR/v1/sys/mounts/transit" > /dev/null 2>&1 || true
  for i in $(seq 1 $N); do
    curl -fsS -X POST -H "X-Vault-Token: $VAULT_TOKEN" -d '{}' "$VAULT_ADDR/v1/transit/keys/mpc-node-node$i" > /dev/null
  done
fi

# ---- private CA and certificates --------------------------------------------
if [ "$TLS" = "1" ]; then
  if [ ! -f "$DIR/pki/ca/ca.key" ]; then
    "$BIN" pki-init -dir "$DIR/pki/ca" -name "FORGE dev MPC CA" > /dev/null
  fi
  for who in coordinator $(seq -f 'node%g' 1 $N); do
    [ -f "$DIR/pki/$who/cert.pem" ] || "$BIN" pki-issue -ca "$DIR/pki/ca" -name "$who" -hosts 127.0.0.1,localhost -out "$DIR/pki/$who" > /dev/null
  done
fi

node_env() { # node-specific environment for `mpc-node`
  local i=$1
  echo "MPC_SEAL_PROVIDER=$SEAL"
  if [ "${MPC_DEV_BACKUP:-0}" = "1" ] || [ -f "$DIR/recovery/recipient.txt" ]; then
    echo "MPC_BACKUP_RECIPIENTS=$(cat "$DIR/recovery/recipient.txt")"
    echo "MPC_BACKUP_DIR=$DIR/backups"
  fi
  if [ "$TLS" = "1" ]; then
    echo "MPC_TLS_CA_FILE=$DIR/pki/node$i/ca.pem"
    echo "MPC_TLS_CERT_FILE=$DIR/pki/node$i/cert.pem"
    echo "MPC_TLS_KEY_FILE=$DIR/pki/node$i/key.pem"
  fi
}

if [ "${MPC_DEV_BACKUP:-0}" = "1" ] && [ ! -f "$DIR/recovery/recipient.txt" ]; then
  "$BIN" backup-keygen -k 2 -n 3 -out "$DIR/recovery" > /dev/null
  echo "created a recovery key in $DIR/recovery (dev only: officer shares sit next to the cluster)"
fi

if [ ! -f "$DIR/cluster.json" ]; then
  "$BIN" coordinator-key -out "$DIR/coordinator.key" > "$DIR/coordinator.pub"
  ids=()
  for i in $(seq 1 $N); do
    port=$((BASE_PORT + i - 1))
    env $(node_env $i) "$BIN" init -id "node$i" -data "$DIR/node$i" -url "$SCHEME://127.0.0.1:$port" -domain "dev-local" > /dev/null 2>&1
    ids+=("$DIR/node$i/identity.json")
  done
  "$BIN" cluster -threshold $THRESHOLD -coordinator-pub "$(cat "$DIR/coordinator.pub")" -out "$DIR/cluster.json" "${ids[@]}"
  echo "created cluster in $DIR"
fi
# The cluster file is public; keep its URLs in step with the transport in use.
if [ "$TLS" = "1" ]; then sed -i 's#"url": "http://#"url": "https://#' "$DIR/cluster.json"; else sed -i 's#"url": "https://#"url": "http://#' "$DIR/cluster.json"; fi

# ---- a modest per-node policy ------------------------------------------------
# Each node enforces this itself, whatever the coordinator asks. A real
# deployment writes these by hand, per node, on that node's own host.
if [ "$POLICY" = "1" ]; then
  for i in $(seq 1 $N); do
    [ -f "$DIR/node$i/policy.json" ] || cat > "$DIR/node$i/policy.json" <<'P'
{
  "maxValueWei": "100000000000000000000",
  "maxFeeWei": "1000000000000000000",
  "maxTxPerHour": 1000
}
P
  done
fi

probe() { # health check that works with or without mutual TLS
  local port=$1
  if [ "$TLS" = "1" ]; then
    curl -fs --max-time 2 --cacert "$DIR/pki/coordinator/ca.pem" --cert "$DIR/pki/coordinator/cert.pem" --key "$DIR/pki/coordinator/key.pem" "https://127.0.0.1:$port/v1/health" > /dev/null 2>&1
  else
    curl -fs --max-time 2 "http://127.0.0.1:$port/v1/health" > /dev/null 2>&1
  fi
}

for i in $(seq 1 $N); do
  port=$((BASE_PORT + i - 1))
  if probe "$port"; then
    echo "node$i: already up on :$port"
    continue
  fi
  args=(serve -id "node$i" -data "$DIR/node$i" -cluster "$DIR/cluster.json" -listen "127.0.0.1:$port")
  [ "$POLICY" = "1" ] && args+=(-policy "$DIR/node$i/policy.json")
  # Each node is its own process with its own environment; setsid detaches it.
  setsid nohup env $(node_env $i) "$BIN" "${args[@]}" < /dev/null > "$DIR/logs/node$i.log" 2>&1 &
  echo "node$i: started on :$port"
done

{
  echo "MPC_CLUSTER_FILE=$DIR/cluster.json"
  echo "MPC_COORDINATOR_KEY_FILE=$DIR/coordinator.key"
  if [ "$TLS" = "1" ]; then
    echo "MPC_TLS_CA_FILE=$DIR/pki/coordinator/ca.pem"
    echo "MPC_TLS_CERT_FILE=$DIR/pki/coordinator/cert.pem"
    echo "MPC_TLS_KEY_FILE=$DIR/pki/coordinator/key.pem"
  fi
} > "$DIR/signer.env"

echo
echo "coordinator env for the signer is in $DIR/signer.env:"
sed 's/^/  /' "$DIR/signer.env"
