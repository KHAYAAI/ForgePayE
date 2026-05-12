"""
Monitoring router — AML transaction evaluation and alert management.

Routes:
    POST /api/v1/monitoring/evaluate           → evaluate single transaction
    GET  /api/v1/monitoring/alerts             → active monitoring alerts for merchant
    GET  /api/v1/monitoring/rules              → list all active rules
    PUT  /api/v1/monitoring/rules/{id}/toggle  → enable/disable a rule
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from src.auth import require_auth
from src.models import EvaluateTransactionRequest, TransactionMonitoringResult

router = APIRouter(prefix="/api/v1/monitoring", tags=["Monitoring"])


def _engine(request: Request):
    return request.app.state.monitoring_engine


@router.post(
    "/evaluate",
    response_model=TransactionMonitoringResult,
    summary="Evaluate a single transaction against all AML monitoring rules",
)
async def evaluate_transaction(
    body: EvaluateTransactionRequest,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> TransactionMonitoringResult:
    engine = _engine(request)
    transaction = body.model_dump()
    # Map to internal key names expected by the rule engine
    transaction["id"] = transaction.pop("transaction_id")
    transaction["amount_usd"] = transaction.pop("amount")  # caller provides USD amount
    return await engine.evaluate_transaction(transaction)


@router.get(
    "/alerts",
    response_model=list[TransactionMonitoringResult],
    summary="List active monitoring alerts, optionally filtered by merchant_id",
)
async def list_alerts(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
    merchant_id: str | None = Query(default=None, description="Filter by merchant ID"),
) -> list[TransactionMonitoringResult]:
    engine = _engine(request)
    return engine.get_alerts(merchant_id=merchant_id)


@router.get(
    "/rules",
    response_model=list[dict],
    summary="List all AML monitoring rules and their enabled state",
)
async def list_rules(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> list[dict]:
    engine = _engine(request)
    return engine.list_rules()


@router.put(
    "/rules/{rule_id}/toggle",
    response_model=dict,
    summary="Enable or disable an AML monitoring rule",
)
async def toggle_rule(
    rule_id: str,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
    enabled: bool = Query(..., description="True to enable, False to disable"),
) -> dict:
    engine = _engine(request)
    found = engine.toggle_rule(rule_id, enabled)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Rule {rule_id!r} not found",
        )
    return {"rule_id": rule_id, "enabled": enabled, "status": "updated"}
