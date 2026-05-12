"""
Sanctions router — list management, manual refresh, and ad-hoc search.

Routes:
    GET  /api/v1/sanctions/lists               → list status (age, entry count) per list
    POST /api/v1/sanctions/refresh             → trigger manual list refresh
    GET  /api/v1/sanctions/search?q=name       → ad-hoc search across all lists
"""

from __future__ import annotations

from typing import Annotated

import asyncio
from fastapi import APIRouter, Depends, Query, Request

from src.auth import require_auth
from src.models import SanctionsMatch

router = APIRouter(prefix="/api/v1/sanctions", tags=["Sanctions"])


@router.get(
    "/lists",
    response_model=list[dict],
    summary="Return status (age and entry count) for each active sanctions list",
)
async def list_status(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> list[dict]:
    ofac = request.app.state.ofac_manager
    eu = request.app.state.eu_manager

    return [
        {
            "list_name": "OFAC_SDN",
            "age_hours": round(ofac.get_list_age_hours(), 2),
            "entry_count": ofac.entry_count(),
            "source_url": "https://www.treasury.gov/ofac/downloads/sdn.xml",
        },
        {
            "list_name": "EU_CONSOLIDATED",
            "age_hours": round(eu.get_list_age_hours(), 2),
            "entry_count": eu.entry_count(),
            "source_url": (
                "https://webgate.ec.europa.eu/fsd/fsf/public/files/"
                "xmlFullSanctionsList_1_1/content"
            ),
        },
    ]


@router.post(
    "/refresh",
    response_model=dict,
    summary="Trigger an immediate refresh of all sanctions lists",
)
async def refresh_lists(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> dict:
    ofac = request.app.state.ofac_manager
    eu = request.app.state.eu_manager

    # Refresh both lists concurrently
    await asyncio.gather(ofac.refresh_list(), eu.refresh_list())

    return {
        "status": "refreshed",
        "ofac": {
            "entry_count": ofac.entry_count(),
            "age_hours": round(ofac.get_list_age_hours(), 2),
        },
        "eu": {
            "entry_count": eu.entry_count(),
            "age_hours": round(eu.get_list_age_hours(), 2),
        },
    }


@router.get(
    "/search",
    response_model=list[SanctionsMatch],
    summary="Ad-hoc fuzzy name search across all active sanctions lists",
)
async def search_sanctions(
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
    q: str = Query(..., min_length=2, description="Name or entity to search for"),
    threshold: float = Query(
        default=0.85,
        ge=0.5,
        le=1.0,
        description="Minimum fuzzy similarity threshold (0.5–1.0)",
    ),
) -> list[SanctionsMatch]:
    ofac = request.app.state.ofac_manager
    eu = request.app.state.eu_manager

    import asyncio
    import concurrent.futures

    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        ofac_fut = loop.run_in_executor(pool, ofac.search, q, threshold)
        eu_fut = loop.run_in_executor(pool, eu.search, q, threshold)
        ofac_matches, eu_matches = await asyncio.gather(ofac_fut, eu_fut)

    combined = list(ofac_matches) + list(eu_matches)
    combined.sort(key=lambda m: m.similarity_score, reverse=True)
    return combined
