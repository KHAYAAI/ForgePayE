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
    return await mgr.create_draft_sar(
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
    return await mgr.get_sars(merchant_id=effective_merchant_id, status=sar_status)


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
    sar = await mgr.get_sar(sar_id)
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
    existing = await mgr.get_sar(sar_id)
    if existing is not None:
        require_merchant_access(caller, existing.merchant_id)
    try:
        return await mgr.submit_sar(sar_id)
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
    return await mgr.get_ctrs(merchant_id=effective_merchant_id, status=ctr_status)


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

    stats = await sar_mgr.get_dashboard_stats()
    all_alerts = await monitoring_engine.get_alerts()

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


# ---------------------------------------------------------------------------
# goAML (South Africa FIC) report drafts — exported for an officer, never filed
# ---------------------------------------------------------------------------

from datetime import UTC, datetime  # noqa: E402

from fastapi.responses import Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from sqlalchemy import select  # noqa: E402

from src.config import get_settings  # noqa: E402
from src.db.models import CtrRow, GoamlExportRow, SarRow  # noqa: E402
from src.reporting.goaml import build_ctr, build_str  # noqa: E402
from src.reporting.sar import _ctr_from_row, _sar_from_row  # noqa: E402


class GoamlExportRequest(BaseModel):
    approved_by: str = Field(min_length=2, max_length=255, description="Full name of the compliance officer approving this export")


async def _record_export(request: Request, code: str, source_id: str, xml: str, approved_by: str, principal: str) -> None:
    async with request.app.state.sar_manager._session_factory() as session:
        session.add(GoamlExportRow(
            report_code=code, source_id=source_id, xml=xml, approved_by=approved_by,
            approved_by_principal=principal, created_at=datetime.now(UTC).isoformat(),
        ))
        await session.commit()


@router.post(
    "/goaml/str/{sar_id}",
    summary="Export a goAML STR draft from a SAR (admin; not submitted to the FIC)",
)
async def export_goaml_str(
    sar_id: str,
    body: GoamlExportRequest,
    request: Request,
    caller: Annotated[dict, Depends(require_admin)],
) -> Response:
    settings = get_settings()
    async with request.app.state.sar_manager._session_factory() as session:
        row = await session.get(SarRow, sar_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"SAR {sar_id} not found")
        sar = _sar_from_row(row)
    xml = build_str(sar, rentity_id=settings.fic_rentity_id, approved_by=body.approved_by)
    await _record_export(request, "STR", sar_id, xml, body.approved_by, str(caller.get("merchant_id", "")))
    return Response(content=xml, media_type="application/xml",
                    headers={"X-Filing-Status": "not-submitted; upload via goAML after XSD validation"})


@router.post(
    "/goaml/ctr/{ctr_id}",
    summary="Export a goAML CTR draft (admin; not submitted to the FIC)",
)
async def export_goaml_ctr(
    ctr_id: str,
    body: GoamlExportRequest,
    request: Request,
    caller: Annotated[dict, Depends(require_admin)],
) -> Response:
    settings = get_settings()
    async with request.app.state.sar_manager._session_factory() as session:
        row = await session.get(CtrRow, ctr_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"CTR {ctr_id} not found")
        ctr = _ctr_from_row(row)
    try:
        xml = build_ctr(ctr, rentity_id=settings.fic_rentity_id, approved_by=body.approved_by,
                        threshold_zar=settings.za_ctr_threshold_zar)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await _record_export(request, "CTR", ctr_id, xml, body.approved_by, str(caller.get("merchant_id", "")))
    return Response(content=xml, media_type="application/xml",
                    headers={"X-Filing-Status": "not-submitted; upload via goAML after XSD validation"})


@router.get(
    "/goaml/exports",
    summary="Who exported which goAML draft, and when (admin)",
)
async def list_goaml_exports(
    request: Request,
    caller: Annotated[dict, Depends(require_admin)],
) -> list[dict]:
    async with request.app.state.sar_manager._session_factory() as session:
        rows = (await session.execute(select(GoamlExportRow).order_by(GoamlExportRow.created_at.desc()))).scalars().all()
    return [
        {"id": r.id, "report_code": r.report_code, "source_id": r.source_id, "approved_by": r.approved_by,
         "approved_by_principal": r.approved_by_principal, "created_at": r.created_at, "submitted": False}
        for r in rows
    ]
