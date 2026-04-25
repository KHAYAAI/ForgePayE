"""
Auditor decryption API — internal endpoint for trusted services.

POST /v1/auditor/decrypt
  - Called by stablecoin-gateway to decrypt an encrypted memo
  - Returns the plaintext amount (for tax computation)
  - NEVER exposed publicly — internal network only (verified via INTERNAL_SECRET header)

Security: This endpoint must only be reachable from within the Kubernetes cluster.
Configure NetworkPolicy to restrict to stablecoin-gateway → mor-layer only.
"""
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
import base64
import os
from ..auditor import AuditorClient

router = APIRouter(prefix="/v1/auditor", tags=["auditor"])

INTERNAL_SECRET = os.environ.get("INTERNAL_WEBHOOK_SECRET", "dev-internal-secret-change-me")


def verify_internal(x_internal_secret: str = Header(default="")) -> None:
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden: internal endpoint")


class DecryptRequest(BaseModel):
    encrypted_memo: str  # base64-encoded EncryptedMemo


class DecryptResponse(BaseModel):
    asset: str
    amount: float
    amount_units: str
    owner_pk: str
    nullifier: str
    commitment: str
    merchant_id: str


@router.post("/decrypt", response_model=DecryptResponse)
async def decrypt_memo(
    body: DecryptRequest,
    _: None = Depends(verify_internal),
) -> DecryptResponse:
    """Decrypt an encrypted memo using the auditor's ECDH key."""
    auditor_seed = os.environ.get("AUDITOR_SEED_HEX")
    if not auditor_seed:
        raise HTTPException(status_code=503, detail="Auditor seed not configured")

    try:
        memo_bytes = base64.b64decode(body.encrypted_memo)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 in encrypted_memo")

    client = AuditorClient.from_seed(auditor_seed)
    try:
        tx_data = client.decrypt_shielded_tx(memo_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Decryption failed: {exc}")

    amount_units = str(int(tx_data.amount * 1_000_000))  # assume 6-decimal stablecoin
    return DecryptResponse(
        asset=str(tx_data.asset),
        amount=float(tx_data.amount),
        amount_units=amount_units,
        owner_pk=str(tx_data.owner_pk),
        nullifier=str(tx_data.nullifier),
        commitment=str(tx_data.commitment),
        merchant_id=str(tx_data.merchant_id),
    )
