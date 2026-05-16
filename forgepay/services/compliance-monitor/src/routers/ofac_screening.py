"""
OFAC real-time screening router.

Routes:
    POST /v1/screening              → screen a single transaction
    POST /v1/screening/batch        → screen multiple transactions
    GET  /v1/sanctions/ofac/status  → OFAC feed status and metrics
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from src.auth import require_auth
from src.sanctions.screening import ScreeningResult, TransactionScreeningEngine

router = APIRouter(prefix="/v1", tags=["OFAC Screening"])


# ------------------------------------------------------------------
# Dependency: get screening engine from app state
# ------------------------------------------------------------------


def _screening_engine(request: Request) -> TransactionScreeningEngine:
    """Dependency to retrieve the screening engine from app state."""
    engine = getattr(request.app.state, "screening_engine", None)
    if not engine:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Screening engine not initialized",
        )
    return engine


# ------------------------------------------------------------------
# POST /v1/screening — Screen a single transaction
# ------------------------------------------------------------------


class ScreenTransactionRequest:
    """Request body for screening endpoint."""
    def __init__(
        self,
        transaction_id: str,
        agent_id: str,
        counterparty_name: str,
        amount_usd: float,
    ) -> None:
        self.transaction_id = transaction_id
        self.agent_id = agent_id
        self.counterparty_name = counterparty_name
        self.amount_usd = amount_usd


class ScreenTransactionResponse:
    """Response body for screening endpoint."""
    def __init__(self, result: ScreeningResult) -> None:
        self.transaction_id = result.transaction_id
        self.agent_id = result.agent_id
        self.counterparty_name = result.counterparty_name
        self.amount_usd = result.amount_usd
        self.risk_score = result.risk_score
        self.is_match = result.is_match
        self.matched_entries = result.matched_entries
        self.hit_reasons = result.hit_reasons
        self.screened_at = result.screened_at
        self.recommended_action = self._recommend_action(result.risk_score)

    @staticmethod
    def _recommend_action(risk_score: int) -> str:
        """Recommend action based on risk score."""
        if risk_score >= 80:
            return "block"
        if risk_score >= 40:
            return "review"
        return "allow"

    def dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON response."""
        return {
            "transaction_id": self.transaction_id,
            "agent_id": self.agent_id,
            "counterparty_name": self.counterparty_name,
            "amount_usd": self.amount_usd,
            "risk_score": self.risk_score,
            "is_match": self.is_match,
            "matched_entries": self.matched_entries,
            "hit_reasons": self.hit_reasons,
            "screened_at": self.screened_at,
            "recommended_action": self.recommended_action,
        }


@router.post(
    "/screening",
    response_model=dict,
    summary="Screen a transaction against OFAC/DPL/EEL in real-time",
    status_code=200,
)
async def screen_transaction(
    body: dict[str, Any],
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> dict[str, Any]:
    """
    Screen a transaction in real-time against OFAC SDN, BIS DPL, and BIS EEL lists.

    Request body:
    ```json
    {
      "transaction_id": "txn-12345",
      "agent_id": "agent-xyz",
      "counterparty_name": "ACME Corporation",
      "amount_usd": 50000.00
    }
    ```

    Response includes:
      - risk_score: 0–100 composite score
      - is_match: boolean (match found if risk_score >= 40)
      - matched_entries: list of SDN/DPL/EEL entries that matched
      - hit_reasons: list of strings explaining why it matched
      - recommended_action: "allow" | "review" | "block"
    """
    # Validate required fields
    required_fields = ["transaction_id", "agent_id", "counterparty_name", "amount_usd"]
    for field in required_fields:
        if field not in body:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Missing required field: {field}",
            )

    engine = _screening_engine(request)
    result = await engine.screen_transaction(
        transaction_id=body["transaction_id"],
        agent_id=body["agent_id"],
        counterparty_name=body["counterparty_name"],
        amount_usd=float(body["amount_usd"]),
    )

    response = ScreenTransactionResponse(result)
    return response.dict()


# ------------------------------------------------------------------
# POST /v1/screening/batch — Screen multiple transactions
# ------------------------------------------------------------------


@router.post(
    "/screening/batch",
    response_model=list[dict],
    summary="Screen multiple transactions concurrently",
    status_code=200,
)
async def batch_screen_transactions(
    body: dict[str, Any],
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> list[dict[str, Any]]:
    """
    Screen multiple transactions in a single request.

    Request body:
    ```json
    {
      "transactions": [
        {
          "transaction_id": "txn-1",
          "agent_id": "agent-xyz",
          "counterparty_name": "Company A",
          "amount_usd": 25000.00
        },
        ...
      ]
    }
    ```

    Returns array of screening results.
    """
    if "transactions" not in body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing 'transactions' field",
        )

    transactions = body["transactions"]
    if not isinstance(transactions, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'transactions' must be an array",
        )

    if len(transactions) > 500:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Batch size may not exceed 500 transactions",
        )

    engine = _screening_engine(request)
    results = await engine.batch_screen(transactions)

    return [ScreenTransactionResponse(result).dict() for result in results]


# ------------------------------------------------------------------
# POST /v1/sanctions/refresh — Manually refresh OFAC feeds
# ------------------------------------------------------------------


@router.post(
    "/sanctions/refresh",
    response_model=dict,
    summary="Manually trigger OFAC feed refresh",
    status_code=200,
)
async def refresh_sanctions_feeds(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> dict[str, Any]:
    """
    Manually trigger a refresh of all OFAC feeds (SDN, DPL, EEL).

    This is useful for testing or when Treasury.gov updates their lists
    outside the normal scheduling window.

    Returns:
    ```json
    {
      "status": "success",
      "SDN": {"entry_count": 12345, "age_hours": 0.1, "cache_status": "refreshed"},
      "DPL": {...},
      "EEL": {...}
    }
    ```
    """
    ofac_feed_manager = getattr(request.app.state, "ofac_feed_manager", None)
    if not ofac_feed_manager:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OFAC feed manager not initialized",
        )

    try:
        result = await ofac_feed_manager.refresh_all_feeds()
        return {
            "status": "success",
            **result,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Feed refresh failed: {str(exc)}",
        )


# ------------------------------------------------------------------
# GET /v1/sanctions/ofac/status — OFAC feed status
# ------------------------------------------------------------------


@router.get(
    "/sanctions/ofac/status",
    response_model=dict,
    summary="Get OFAC feed status (SDN, DPL, EEL age and entry counts)",
    status_code=200,
)
async def ofac_status(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> dict[str, Any]:
    """
    Get metadata about loaded OFAC feeds (CSV-based feeds from OfacFeedManager).

    Returns:
    ```json
    {
      "last_refresh": "2026-05-16T12:00:00Z",
      "feeds": {
        "SDN": {
          "entry_count": 12345,
          "age_hours": 2.5,
          "hash": "abc123def456"
        },
        "DPL": {...},
        "EEL": {...}
      }
    }
    ```
    """
    # First try to get status from OFAC feed manager (CSV-based, real-time)
    ofac_feed_manager = getattr(request.app.state, "ofac_feed_manager", None)
    if ofac_feed_manager:
        from datetime import datetime, timezone
        feed_status = ofac_feed_manager.get_feed_status()
        return {
            "last_refresh": datetime.now(timezone.utc).isoformat(),
            "feeds": feed_status,
            "source": "csv_feeds",
        }

    # Fallback to OFAC XML manager
    ofac_manager = getattr(request.app.state, "ofac_manager", None)
    if not ofac_manager:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OFAC manager not initialized",
        )

    from datetime import datetime, timezone
    return {
        "last_refresh": datetime.now(timezone.utc).isoformat(),
        "ofac_age_hours": round(ofac_manager.get_list_age_hours(), 2),
        "ofac_entry_count": ofac_manager.entry_count(),
        "source": "xml_feed",
    }
