"""
Webhooks router — inbound alerts from Chainalysis KYT and Elliptic.

Routes:
    POST /webhooks/chainalysis  → Chainalysis KYT alert
    POST /webhooks/elliptic     → Elliptic transaction alert

Both endpoints validate HMAC-SHA256 signatures on the request body.
Alert data is ingested into the monitoring engine as synthetic transactions
so that downstream SAR logic can be triggered automatically.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, Header, HTTPException, Request, status

from src.config import get_settings
from src.models import WebhookChainalysisAlert, WebhookEllipticAlert

logger = structlog.get_logger(__name__)
settings = get_settings()

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

# ---------------------------------------------------------------------------
# Signature verification helpers
# ---------------------------------------------------------------------------

_ALERT_LEVEL_TO_SCORE: dict[str, int] = {
    "SEVERE": 90,
    "HIGH": 70,
    "MEDIUM": 45,
    "LOW": 20,
}


def _verify_hmac(
    body: bytes,
    signature_header: str | None,
    secret: str,
    algo: str = "sha256",
) -> bool:
    """
    Verify an HMAC-SHA256 webhook signature.

    Signature header format expected: "sha256=<hex_digest>"
    """
    if not secret or not signature_header:
        # If no secret configured, log warning and accept in dev; reject in prod
        if settings.environment == "production":
            return False
        logger.warning("webhook.signature_check_skipped_no_secret")
        return True

    try:
        scheme, _, digest = signature_header.partition("=")
        if scheme.lower() != algo:
            return False
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, digest)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Chainalysis KYT webhook
# ---------------------------------------------------------------------------


@router.post(
    "/chainalysis",
    status_code=status.HTTP_200_OK,
    summary="Receive Chainalysis KYT blockchain risk alerts",
)
async def chainalysis_webhook(
    request: Request,
    x_chainalysis_signature: str | None = Header(default=None),
) -> dict[str, str]:
    body = await request.body()

    if not _verify_hmac(body, x_chainalysis_signature, settings.chainalysis_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Chainalysis webhook signature",
        )

    try:
        payload = WebhookChainalysisAlert.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid Chainalysis payload: {exc}",
        ) from exc

    logger.info(
        "webhook.chainalysis.received",
        alert_id=payload.alert_id,
        alert_type=payload.alert_type,
        alert_level=payload.alert_level,
        address=payload.address[:12] + "..." if len(payload.address) > 12 else payload.address,
    )

    # Convert the KYT alert into a synthetic transaction for the monitoring engine
    risk_score = _ALERT_LEVEL_TO_SCORE.get(payload.alert_level.upper(), 50)
    synthetic_txn = _chainalysis_to_transaction(payload, risk_score)

    monitoring_engine = request.app.state.monitoring_engine
    result = await monitoring_engine.evaluate_transaction(synthetic_txn)

    logger.info(
        "webhook.chainalysis.processed",
        alert_id=payload.alert_id,
        monitoring_decision=result.decision,
        risk_score=result.risk_score,
        requires_sar=result.requires_sar,
    )

    return {"status": "accepted", "alert_id": payload.alert_id}


# ---------------------------------------------------------------------------
# Elliptic webhook
# ---------------------------------------------------------------------------


@router.post(
    "/elliptic",
    status_code=status.HTTP_200_OK,
    summary="Receive Elliptic blockchain transaction risk alerts",
)
async def elliptic_webhook(
    request: Request,
    x_elliptic_signature: str | None = Header(default=None),
) -> dict[str, str]:
    body = await request.body()

    if not _verify_hmac(body, x_elliptic_signature, settings.elliptic_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Elliptic webhook signature",
        )

    try:
        payload = WebhookEllipticAlert.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid Elliptic payload: {exc}",
        ) from exc

    logger.info(
        "webhook.elliptic.received",
        id=payload.id,
        blockchain=payload.blockchain,
        risk_score=payload.risk_score,
        tx_hash=payload.hash[:16] + "...",
    )

    synthetic_txn = _elliptic_to_transaction(payload)
    monitoring_engine = request.app.state.monitoring_engine
    result = await monitoring_engine.evaluate_transaction(synthetic_txn)

    logger.info(
        "webhook.elliptic.processed",
        elliptic_id=payload.id,
        monitoring_decision=result.decision,
        risk_score=result.risk_score,
    )

    return {"status": "accepted", "id": payload.id}


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------


def _chainalysis_to_transaction(
    alert: WebhookChainalysisAlert, base_risk_score: int
) -> dict[str, Any]:
    """Map a Chainalysis KYT alert to the internal transaction dict schema."""
    return {
        "id": f"chainalysis-{alert.alert_id}",
        "merchant_id": alert.metadata.get("merchant_id", "unknown"),
        "amount": 0.0,
        "amount_usd": 0.0,
        "currency": alert.asset.upper(),
        "payment_method": "crypto",
        "payer_country": alert.metadata.get("country", ""),
        "payer_ip_country": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "source": "chainalysis_kyt",
            "alert_type": alert.alert_type,
            "alert_level": alert.alert_level,
            "exposure_type": alert.exposure_type,
            "address": alert.address,
            "network": alert.network,
            "external_risk_score": base_risk_score,
            **alert.metadata,
        },
    }


def _elliptic_to_transaction(alert: WebhookEllipticAlert) -> dict[str, Any]:
    """Map an Elliptic alert to the internal transaction dict schema."""
    return {
        "id": f"elliptic-{alert.id}",
        "merchant_id": alert.metadata.get("merchant_id", "unknown"),
        "amount": 0.0,
        "amount_usd": 0.0,
        "currency": alert.blockchain.upper(),
        "payment_method": "crypto",
        "payer_country": alert.metadata.get("country", ""),
        "payer_ip_country": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "source": "elliptic",
            "tx_hash": alert.hash,
            "blockchain": alert.blockchain,
            "external_risk_score": int(alert.risk_score),
            "risk_rules": alert.risk_rules,
            **alert.metadata,
        },
    }
