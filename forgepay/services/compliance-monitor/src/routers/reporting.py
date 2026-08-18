"""
Reporting router — SAR and CTR management, compliance dashboard.

Routes:
    POST /api/v1/reporting/sar                 → create draft SAR
    GET  /api/v1/reporting/sar                 → list SARs (optionally filtered)
    GET  /api/v1/reporting/sar/{id}            → get SAR detail
    PUT  /api/v1/reporting/sar/{id}/submit     → submit SAR to FinCEN
    GET  /api/v1/reporting/ctr                 → Currency Transaction Reports
    GET  /api/v1/reporting/dashboard           → compliance dashboard stats
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from src.auth import require_admin, require_auth, require_merchant_access, scoped_merchant_id
from src.models import CreateSarRequest, CtrReport, SarReport

router = APIRouter(prefix="/api/v1/reporting", tags=["Reporting"])


def _sar_manager(request: Request):
    return request.app.state.sar_manager


@router.post(
    "/sar",
    response_model=SarReport,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new draft SAR",
)
async def create_sar(
    body: CreateSarRequest,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> SarReport:
    # A caller may only file a SAR under their own merchant, unless admin.
    require_merchant_access(caller, body.merchant_id)

    mgr = _sar_manager(request)
    return mgr.create_draft_sar(
        merchant_id=body.merchant_id,
        transaction_ids=body.transaction_ids,
        activity_description=body.activity_description,
        suspicious_types=body.suspicious_activity_types,
        filing_type=body.filing_type,
        activity_start_date=body.activity_start_date,
        activity_end_date=body.activity_end_date,
        total_amount=body.total_amount,
    )


@router.get(
    "/sar",
    response_model=list[SarReport],
    summary="List SARs, optionally filtered by merchant_id or status",
)
async def list_sars(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
    merchant_id: str | None = Query(default=None),
    sar_status: str | None = Query(default=None, alias="status"),
) -> list[SarReport]:
    mgr = _sar_manager(request)
    effective_merchant_id = scoped_merchant_id(caller, merchant_id)
    return mgr.get_sars(merchant_id=effective_merchant_id, status=sar_status)


@router.get(
    "/sar/{sar_id}",
    response_model=SarReport,
    summary="Retrieve a specific SAR by ID",
)
async def get_sar(
    sar_id: str,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> SarReport:
    mgr = _sar_manager(request)
    sar = mgr.get_sar(sar_id)
    if sar is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"SAR {sar_id!r} not found",
        )
    require_merchant_access(caller, sar.merchant_id)
    return sar


@router.put(
    "/sar/{sar_id}/submit",
    response_model=SarReport,
    summary="Submit a draft SAR to FinCEN",
)
async def submit_sar(
    sar_id: str,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> SarReport:
    mgr = _sar_manager(request)
    existing = mgr.get_sar(sar_id)
    if existing is not None:
        require_merchant_access(caller, existing.merchant_id)
    try:
        return mgr.submit_sar(sar_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc


@router.get(
    "/ctr",
    response_model=list[CtrReport],
    summary="List Currency Transaction Reports (cash > $10,000)",
)
async def list_ctrs(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
    merchant_id: str | None = Query(default=None),
    ctr_status: str | None = Query(default=None, alias="status"),
) -> list[CtrReport]:
    mgr = _sar_manager(request)
    effective_merchant_id = scoped_merchant_id(caller, merchant_id)
    return mgr.get_ctrs(merchant_id=effective_merchant_id, status=ctr_status)


@router.get(
    "/dashboard",
    response_model=dict,
    summary="Compliance dashboard statistics (admin only — aggregates all merchants)",
)
async def dashboard(
    request: Request,
    caller: Annotated[dict, Depends(require_admin)],
) -> dict:
    sar_mgr = _sar_manager(request)
    monitoring_engine = request.app.state.monitoring_engine
    ofac = request.app.state.ofac_manager
    eu = request.app.state.eu_manager

    stats = sar_mgr.get_dashboard_stats()
    all_alerts = monitoring_engine.get_alerts()

    stats["monitoring"] = {
        "total_alerts": len(all_alerts),
        "blocked": sum(1 for a in all_alerts if a.decision == "block"),
        "review": sum(1 for a in all_alerts if a.decision == "review"),
        "sar_required": sum(1 for a in all_alerts if a.requires_sar),
    }
    stats["sanctions_lists"] = {
        "ofac_age_hours": round(ofac.get_list_age_hours(), 2),
        "eu_age_hours": round(eu.get_list_age_hours(), 2),
    }
    return stats
