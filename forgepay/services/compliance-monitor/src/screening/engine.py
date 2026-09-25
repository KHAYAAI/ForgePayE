"""
Screening orchestrator.

Runs entity / crypto-address queries against all active sanctions lists
in parallel and computes a composite risk score.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as redis
import structlog

from src.models import SanctionsMatch, ScreeningResult
from src.sanctions.eu_list import EuSanctionsManager
from src.sanctions.ofac import OfacListManager

logger = structlog.get_logger(__name__)

_CACHE_KEY_PREFIX = "compliance-monitor:screening:"
_DEFAULT_CACHE_TTL_SECONDS = 86_400  # 24 hours

# ---------------------------------------------------------------------------
# Risk score weights
# ---------------------------------------------------------------------------
_HIGH_RISK_PROGRAMS: frozenset[str] = frozenset(
    {
        # OFAC programme codes considered highest risk
        "IRAN", "DPRK", "SYRIA", "CUBA", "RUSSIA", "UKRAINE-EO13661",
        "UKRAINE-EO13662", "BELARUS", "SDT", "SDGT", "CYBER", "DARKNETS",
        "TRANSNATIONAL-CRIMINAL-ORGANIZATIONS", "WMD",
        # EU programme labels
        "UKRAINE",
    }
)

_RESULT_CONFIRMED = "confirmed_match"
_RESULT_POTENTIAL = "potential_match"
_RESULT_CLEAR = "clear"
_RESULT_ERROR = "error"


def _compute_risk_score(matches: list[SanctionsMatch]) -> int:
    """
    Composite risk score 0–100.

    Base = 0
    + 50 for any confirmed match   (similarity >= 0.95)
    + 30 for potential match       (0.85 <= similarity < 0.95)
    + 10 per high-risk program flag (deduplicated)
    """
    if not matches:
        return 0

    score = 0
    has_confirmed = any(m.similarity_score >= 0.95 for m in matches)
    has_potential = any(0.85 <= m.similarity_score < 0.95 for m in matches)

    if has_confirmed:
        score += 50
    elif has_potential:
        score += 30

    # Unique high-risk programmes across all matches
    triggered_programs: set[str] = set()
    for m in matches:
        for p in m.programs:
            if p.upper() in _HIGH_RISK_PROGRAMS:
                triggered_programs.add(p.upper())

    score += len(triggered_programs) * 10
    return min(score, 100)


def _classify_result(matches: list[SanctionsMatch]) -> str:
    if not matches:
        return _RESULT_CLEAR
    if any(m.similarity_score >= 0.95 for m in matches):
        return _RESULT_CONFIRMED
    return _RESULT_POTENTIAL


def _recommend_action(risk_score: int) -> str:
    if risk_score >= 80:
        return "block"
    if risk_score >= 40:
        return "review"
    return "allow"


class ScreeningEngine:
    """
    Orchestrates parallel screening across all active sanctions lists.

    Results are cached in Redis (keyed by entity_id) with a 24h TTL -- this
    is a cache, not a regulatory record, so unlike SAR/CTR/KYC/AML-alert
    persistence (Postgres, and required) a Redis outage degrades screening
    history/re-lookup rather than failing the request: screen_entity() and
    screen_crypto_address() always compute and return a fresh result even if
    the cache read/write itself fails (see _store()/_get_cached()).
    """

    def __init__(
        self,
        ofac: OfacListManager,
        eu: EuSanctionsManager,
        redis_client: redis.Redis,
        threshold: float = 0.85,
        cache_ttl_seconds: int = _DEFAULT_CACHE_TTL_SECONDS,
    ) -> None:
        self._ofac = ofac
        self._eu = eu
        self._threshold = threshold
        self._redis = redis_client
        self._cache_ttl_seconds = cache_ttl_seconds

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def screen_entity(
        self,
        entity_id: str,
        entity_type: str,
        name: str,
        crypto_addresses: list[str] | None = None,
        bank_accounts: list[str] | None = None,
    ) -> ScreeningResult:
        """
        Screen a person or business across OFAC + EU lists in parallel.

        Crypto addresses (if provided) are also screened against OFAC's
        digital-currency-address entries.
        """
        logger.info("screening.entity", entity_id=entity_id, entity_type=entity_type)

        try:
            # Parallel name search across lists
            ofac_task = asyncio.get_event_loop().run_in_executor(
                None, self._ofac.search, name, self._threshold
            )
            eu_task = asyncio.get_event_loop().run_in_executor(
                None, self._eu.search, name, self._threshold
            )
            ofac_matches, eu_matches = await asyncio.gather(ofac_task, eu_task)

            all_matches: list[SanctionsMatch] = list(ofac_matches) + list(eu_matches)

            # Additionally check any supplied crypto addresses
            for addr in (crypto_addresses or []):
                addr_matches = self._ofac.check_crypto_address(addr)
                all_matches.extend(addr_matches)

            risk_score = _compute_risk_score(all_matches)
            result = ScreeningResult(
                entity_id=entity_id,
                entity_type=entity_type,
                name=name,
                screened_at=datetime.now(UTC).isoformat(),
                result=_classify_result(all_matches),
                matches=all_matches,
                risk_score=risk_score,
                recommended_action=_recommend_action(risk_score),
            )
        except Exception as exc:
            logger.exception("screening.entity.error", entity_id=entity_id, error=str(exc))
            result = ScreeningResult(
                entity_id=entity_id,
                entity_type=entity_type,
                name=name,
                screened_at=datetime.now(UTC).isoformat(),
                result=_RESULT_ERROR,
                matches=[],
                risk_score=0,
                recommended_action="review",
            )

        await self._store(entity_id, result)
        return result

    async def screen_crypto_address(self, address: str) -> ScreeningResult:
        """Screen a blockchain address against OFAC's crypto address entries."""
        logger.info("screening.crypto_address", address=address[:12] + "...")

        try:
            matches = self._ofac.check_crypto_address(address)
            risk_score = _compute_risk_score(matches)
            result = ScreeningResult(
                entity_id=address,
                entity_type="crypto_address",
                name=address,
                screened_at=datetime.now(UTC).isoformat(),
                result=_classify_result(matches),
                matches=matches,
                risk_score=risk_score,
                recommended_action=_recommend_action(risk_score),
            )
        except Exception as exc:
            logger.exception("screening.crypto_address.error", error=str(exc))
            result = ScreeningResult(
                entity_id=address,
                entity_type="crypto_address",
                name=address,
                screened_at=datetime.now(UTC).isoformat(),
                result=_RESULT_ERROR,
                matches=[],
                risk_score=0,
                recommended_action="review",
            )

        await self._store(address, result)
        return result

    async def batch_screen(
        self, entities: list[dict[str, Any]]
    ) -> list[ScreeningResult]:
        """
        Screen multiple entities concurrently.

        Each item in `entities` is a dict with keys matching
        screen_entity's parameters.
        """
        tasks = [
            self.screen_entity(
                entity_id=e["entity_id"],
                entity_type=e["entity_type"],
                name=e["name"],
                crypto_addresses=e.get("crypto_addresses"),
                bank_accounts=e.get("bank_accounts"),
            )
            for e in entities
        ]
        return list(await asyncio.gather(*tasks))

    async def get_history(self, entity_id: str) -> list[ScreeningResult]:
        """Return the cached screening result for the given entity_id, if any."""
        cached = await self._get_cached(entity_id)
        if cached is None:
            return []
        return [cached]

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _cache_key(self, entity_id: str) -> str:
        return f"{_CACHE_KEY_PREFIX}{entity_id}"

    async def _store(self, entity_id: str, result: ScreeningResult) -> None:
        """
        Cache the latest screening result for `entity_id` with a 24h TTL.

        Best-effort: a Redis outage is logged, not raised -- the caller
        already has the freshly-computed `result` either way.
        """
        try:
            await self._redis.setex(
                self._cache_key(entity_id),
                self._cache_ttl_seconds,
                result.model_dump_json(),
            )
        except Exception as exc:
            logger.warning("screening.cache_store_failed", entity_id=entity_id, error=str(exc))

    async def _get_cached(self, entity_id: str) -> ScreeningResult | None:
        try:
            raw = await self._redis.get(self._cache_key(entity_id))
        except Exception as exc:
            logger.warning("screening.cache_read_failed", entity_id=entity_id, error=str(exc))
            return None

        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            return ScreeningResult.model_validate_json(raw)
        except Exception as exc:
            logger.warning("screening.cache_decode_failed", entity_id=entity_id, error=str(exc))
            return None
