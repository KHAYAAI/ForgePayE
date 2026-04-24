#!/bin/bash
# Build WASM module for privacy-payment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WASM_CRATE="$PROJECT_ROOT/crates/privacy-payment-wasm"
WASM_OUTPUT="$PROJECT_ROOT/packages/sdk-js/wasm"

echo "Building privacy-payment WASM module..."

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "Error: wasm-pack not found. Install it with: curl https://rustwasm.org/wasm-pack/installer/init.sh -sSf | sh"
    exit 1
fi

# Build for bundler target (ESM + CommonJS)
cd "$WASM_CRATE"
wasm-pack build \
    --target bundler \
    --release \
    --out-dir "$WASM_OUTPUT" \
    -- --features wasm

echo "✅ WASM build complete: $WASM_OUTPUT"
echo ""
echo "Generated files:"
ls -lh "$WASM_OUTPUT"
echo ""
echo "Next: Update forgepay/packages/sdk-js/package.json to add @forgepay/privacy-payment-wasm as dependency"
