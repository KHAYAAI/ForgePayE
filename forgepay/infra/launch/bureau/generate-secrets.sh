#!/usr/bin/env bash
# Generates the random secrets for the bureau launch and writes them to a file you name, mode 0600.
# It refuses to write inside a git work tree and never prints a secret.
#   ./generate-secrets.sh ~/forge-launch-secrets.env
# Load the values into AWS Secrets Manager (or Vault) and delete the file afterwards.
set -euo pipefail
out="${1:?usage: generate-secrets.sh <output file outside the repo>}"
dir="$(cd "$(dirname "$out")" && pwd)"
if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "refusing to write secrets inside a git work tree: $dir" >&2; exit 1
fi
[ ! -e "$out" ] || { echo "refusing to overwrite $out" >&2; exit 1; }
umask 177
{
  echo "BUREAU_ADMIN_API_KEY=$(openssl rand -hex 32)"
  echo "CONSENT_SIGNING_SECRET=$(openssl rand -hex 32)"
  echo "JWT_SECRET=$(openssl rand -hex 32)"
  echo "INTERNAL_WEBHOOK_SECRET=$(openssl rand -hex 32)"
} > "$out"
echo "wrote 4 secrets to $out (mode 0600). Store them in Secrets Manager, then delete the file."
