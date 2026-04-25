#!/usr/bin/env bash
# Build the privacy-payment-wasm crate into a publishable npm package.
# Requires: wasm-pack, cargo (Rust toolchain with wasm32-unknown-unknown target)
#
# Usage:
#   ./forgepay/infra/build/build-wasm.sh
#   ./forgepay/infra/build/build-wasm.sh --release
#
# Output:
#   forgepay/packages/sdk-js/vendor/privacy-payment-wasm/
#   (ESM bundle suitable for browser and Node.js)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"
CRATE_DIR="$REPO_ROOT/crates/privacy-payment-wasm"
OUT_DIR="$REPO_ROOT/forgepay/packages/sdk-js/vendor/privacy-payment-wasm"

echo "[wasm-build] Building crate: $CRATE_DIR"
echo "[wasm-build] Output: $OUT_DIR"

# Ensure wasm32 target is installed
rustup target add wasm32-unknown-unknown

# Build with wasm-pack
# --target bundler: generates ESM with .js + .d.ts (compatible with webpack/vite)
wasm-pack build \
  --target bundler \
  --out-dir "$OUT_DIR" \
  --out-name "privacy_payment_wasm" \
  ${1:+--release} \
  "$CRATE_DIR"

echo "[wasm-build] Done. Output at: $OUT_DIR"
echo "[wasm-build] Files:"
ls -la "$OUT_DIR"
