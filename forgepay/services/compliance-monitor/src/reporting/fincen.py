"""
FinCEN BSA e-filing provider seam.

The gap this closes
────────────────────
submit_sar() used to just flip a SAR's local status from "draft" to
"submitted" -- nothing ever actually called FinCEN's BSA e-filing system
(https://bsaefiling.fincen.treas.gov/main.html). A Postgres row that says
"submitted" is still lying about what happened if no real filing occurred:
that is a second, distinct gap from persistence itself, and this module is
what makes the distinction real.

Mirrors agent-credit-bureau/src/kyb.ts's KybProvider pattern:

  - A narrow provider seam (`FincenFilingProvider`) that answers "what did
    FinCEN's e-filing system actually say", and reports an unconfigured
    integration as an unconfigured integration -- not a throw, and not a
    silent pass.
  - A default `UnconfiguredFincenFilingProvider` that is honest about not
    having a real integration: it never fabricates an acknowledgement id and
    never reports `accepted=True`. Guessing at FinCEN's actual SOAP/REST
    contract without their BSA e-filing credentials and PKI filing
    certificate is how forge-custody's sanctions integration ended up
    404ing on every call -- the honest, buildable fix here is making the
    stub state impossible to mistake for a real filing, not faking the
    filing itself.

SarManager.submit_sar() calls `current_fincen_filing_provider()` and uses
FincenFilingResult.accepted to decide the SAR's new status: "filed" only
when a real provider actually got FinCEN to accept it, "submitted_unfiled"
otherwise (see src/models.py::SarReport.status for the full state list).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

import structlog

from src.models import SarReport

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class FincenFilingResult:
    """
    Outcome of attempting to file a SAR with FinCEN's BSA e-filing system.

    `status` distinguishes three outcomes that must never be collapsed into
    one another:
      "filed"          -- FinCEN actually accepted the filing.
      "not_configured" -- no real FincenFilingProvider is wired up; nothing
                           was ever sent to FinCEN.
      "filing_failed"  -- a real provider tried and FinCEN rejected it or the
                           call errored.
    """

    accepted: bool
    status: str  # "filed" | "not_configured" | "filing_failed"
    acknowledgement_id: str | None = None
    detail: str = ""
    checked_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


class FincenFilingProvider(Protocol):
    """What it means to attempt a real BSA e-filing submission."""

    name: str

    async def file_sar(self, sar: SarReport) -> FincenFilingResult: ...


class UnconfiguredFincenFilingProvider:
    """
    The default provider: honestly answers "I never tried".

    Deliberately not a no-op that looks like success. `not_configured` is a
    real, distinguishable state -- same spirit as UnconfiguredKybProvider
    answering "registry_unavailable" instead of silently passing.
    """

    name = "unconfigured"

    async def file_sar(self, sar: SarReport) -> FincenFilingResult:
        logger.warning(
            "fincen.filing_not_configured",
            sar_id=sar.id,
            merchant_id=sar.merchant_id,
        )
        return FincenFilingResult(
            accepted=False,
            status="not_configured",
            acknowledgement_id=None,
            detail=(
                "No FincenFilingProvider is configured -- this service has never "
                "actually transmitted a SAR to FinCEN's BSA e-filing system. A "
                "real integration requires BSA e-filing credentials and a PKI "
                "filing certificate that are not present in this environment."
            ),
        )


_provider: FincenFilingProvider = UnconfiguredFincenFilingProvider()


def set_fincen_filing_provider(provider: FincenFilingProvider) -> None:
    """Swap the provider -- used by tests and by a real vendor integration."""
    global _provider
    _provider = provider


def current_fincen_filing_provider() -> FincenFilingProvider:
    return _provider
