#!/usr/bin/env bash
# Verify that a container image was built, scanned and signed by the ForgePay images workflow, BEFORE you deploy it.
#
#   verify-image-signature.sh ghcr.io/<owner>/forgepay-<name>@sha256:<64 hex> [git-ref]
#
# For services deployed outside the automated workflow (each custody signing node lives in its own cluster and account, so it is deployed by its
# own operators). It is the same check deploy-service.yml makes: the reference must be a digest (never a tag), and its signature must have been
# made by .github/workflows/forgepay-bureau-images.yml on the release ref (default refs/heads/main). Exit 0 only if both hold.
#
# Needs cosign (https://docs.sigstore.dev/cosign/installation/) and, for a private package, a prior `docker login ghcr.io`.
# Override the repository with FORGEPAY_REPO (default KHAYAAI/ForgePayE; the case must match GitHub's).
set -euo pipefail

IMAGE="${1:-}"
REF="${2:-refs/heads/main}"
REPO="${FORGEPAY_REPO:-KHAYAAI/ForgePayE}"

usage() { echo "usage: $0 <registry/path@sha256:<64 hex>> [git-ref]" >&2; exit 2; }
[ -n "$IMAGE" ] || usage

if ! printf '%s' "$IMAGE" | grep -Eq '^[a-z0-9][a-z0-9.-]*(:[0-9]+)?/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$'; then
  echo "refused: '$IMAGE' is not a reference by digest (registry/path@sha256:<64 lowercase hex>). A tag can move, so it is not accepted." >&2
  exit 1
fi
if ! printf '%s' "$REF" | grep -Eq '^refs/(heads|tags)/[A-Za-z0-9._/-]+$'; then
  echo "refused: '$REF' is not a git ref such as refs/heads/main" >&2
  exit 1
fi
command -v cosign >/dev/null 2>&1 || { echo "cosign is not installed; cannot verify. Nothing has been checked, so do not deploy." >&2; exit 3; }

WANT="https://github.com/${REPO}/.github/workflows/forgepay-bureau-images.yml@${REF}"
echo "image:     $IMAGE"
echo "expecting: a signature made by $WANT"
if cosign verify "$IMAGE" --certificate-identity "$WANT" --certificate-oidc-issuer https://token.actions.githubusercontent.com > /dev/null; then
  echo "OK: signed by the ForgePay images workflow on $REF. It was built and passed the scan in our pipeline."
else
  echo "FAILED: no valid signature from the images workflow on $REF. Do not deploy this image." >&2
  exit 1
fi
