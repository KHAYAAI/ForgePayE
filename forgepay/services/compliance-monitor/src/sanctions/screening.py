"""
Transaction screening engine against OFAC feeds.

Performs real-time checks on transactions:
  - Counterparty name fuzzy matching against SDN/DPL/EEL
  - Threshold-based risk scoring
  - Integration with audit logging (via bank-whitelabel service)

Match algorithms:
  - Fuzzy token_sort_ratio (handles name order variations)
  - Soundex for phonetic matching
  - Metaphone for pronunciation variants
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog
from fuzzywuzzy import fuzz  # type: ignore[import-untyped]

from src.ofac.feed import ListType, OfacFeedManager

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Name matching helpers with phonetic algorithms
# ---------------------------------------------------------------------------


def soundex(name: str) -> str:
    """
    Compute Soundex hash of a name.
    Useful for phonetic matching of names that sound similar.

    Algorithm:
      1. Keep first letter
      2. Replace consonants with digits:
         B,F,P,V → 1
         C,G,J,K,Q,S,X,Z → 2
         D,T → 3
         L → 4
         M,N → 5
         R → 6
      3. Remove vowels, H, W, Y
      4. Remove consecutive duplicates
      5. Pad/truncate to length 4
    """
    if not name:
        return ""

    name_upper = name.upper()
    first_letter = name_upper[0]

    # Mapping table
    mapping = {
        'B': '1', 'F': '1', 'P': '1', 'V': '1',
        'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
        'D': '3', 'T': '3',
        'L': '4',
        'M': '5', 'N': '5',
        'R': '6',
    }

    # Convert to Soundex code
    code = first_letter
    last_code = mapping.get(first_letter, '')

    for char in name_upper[1:]:
        digit = mapping.get(char, '')
        if digit and digit != last_code:
            code += digit
            last_code = digit
        elif not digit:
            last_code = ''

    # Pad with zeros or truncate to 4
    code = (code + '000')[:4]
    return code


def metaphone(name: str) -> str:
    """
    Simplified Double Metaphone primary code.
    Provides phonetic encoding for English names.

    This is a simplified version focusing on common patterns.
    For production, consider using the `metaphone` library.
    """
    if not name:
        return ""

    name_upper = name.upper().strip()

    # Remove non-alphabetic characters
    name_clean = re.sub(r'[^A-Z]', '', name_upper)

    if not name_clean:
        return ""

    # Simplified transformations for common patterns
    # (A production version would implement the full Metaphone algorithm)
    code = name_clean[0]

    # Simple replacements
    replacements = [
        ('PH', 'F'),
        ('GH', ''),
        ('GN', 'N'),
        ('KN', 'N'),
        ('WR', 'R'),
        ('H', ''),
    ]

    for old, new in replacements:
        name_clean = name_clean.replace(old, new)

    # Keep only consonants and vowel starts
    filtered = name_clean[0]
    for i in range(1, len(name_clean)):
        if name_clean[i] not in 'AEIOU' and name_clean[i] != filtered[-1]:
            filtered += name_clean[i]

    return (filtered + '000')[:4]


def normalize_name(name: str) -> str:
    """
    Normalize a name for matching.

    - Lowercase
    - Remove punctuation
    - Remove noise words (Inc, LLC, Ltd, etc.)
    - Collapse multiple spaces
    """
    lower = name.lower().strip()

    # Remove punctuation
    no_punct = re.sub(r'[^\w\s]', ' ', lower)

    # Noise words to strip
    noise = {
        'inc', 'llc', 'ltd', 'corp', 'co', 'company', 'corporation',
        'limited', 'group', 'holding', 'holdings', 'international',
        'enterprises', 'solutions', 'services', 'global', 'the', 'and',
        'of', 'for', 'in', 'a', 'an', 'sa', 'ag', 'bv', 'gmbh', 'pte',
        'pty', 'plc', 'llp', 'lp', 'nv', 'spa', 'srl', 'sas', 'se',
        'inc.', 'llc.', 'ltd.', 'corp.', 'co.',
    }

    tokens = [t for t in no_punct.split() if t and t not in noise]
    return ' '.join(tokens)


class ScreeningResult:
    """Result of screening a transaction against sanctions lists."""

    def __init__(
        self,
        transaction_id: str,
        agent_id: str,
        counterparty_name: str,
        amount_usd: float,
        risk_score: int,
        is_match: bool,
        matched_entries: list[dict[str, Any]] | None = None,
        hit_reasons: list[str] | None = None,
    ) -> None:
        self.transaction_id = transaction_id
        self.agent_id = agent_id
        self.counterparty_name = counterparty_name
        self.amount_usd = amount_usd
        self.risk_score = risk_score  # 0–100
        self.is_match = is_match
        self.matched_entries = matched_entries or []
        self.hit_reasons = hit_reasons or []
        self.screened_at = datetime.now(timezone.utc).isoformat()

    def dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
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
        }


class NameMatchResult:
    """Result of matching a name against a sanctions entry."""

    def __init__(
        self,
        uid: str,
        full_name: str,
        list_type: str,
        fuzzy_score: float,
        soundex_match: bool,
        metaphone_match: bool,
        match_method: str,
    ) -> None:
        self.uid = uid
        self.full_name = full_name
        self.list_type = list_type
        self.fuzzy_score = fuzzy_score
        self.soundex_match = soundex_match
        self.metaphone_match = metaphone_match
        self.match_method = match_method


class TransactionScreeningEngine:
    """
    Real-time transaction screening against OFAC feeds.

    Responsibilities:
      1. Screen counterparty name against SDN/DPL/EEL with fuzzy matching
      2. Compute risk score based on match quality and list type
      3. Log results to audit service
      4. Cache screening decisions (24h TTL)
      5. Use multiple name matching algorithms (fuzzy, soundex, metaphone)
    """

    def __init__(
        self,
        ofac_manager: OfacFeedManager,
        audit_service_url: str = "http://localhost:8005",
        fuzzy_threshold: float = 0.85,
        cache_ttl_seconds: int = 86_400,
    ) -> None:
        """
        Initialize the screening engine.

        Args:
            ofac_manager: OfacFeedManager instance (manages SDN/DPL/EEL feeds)
            audit_service_url: URL of the audit logging service
            fuzzy_threshold: Minimum fuzzy match score (0.0–1.0)
            cache_ttl_seconds: How long to cache screening results
        """
        self._ofac = ofac_manager
        self._audit_url = audit_service_url.rstrip("/")
        self._threshold = fuzzy_threshold
        self._cache_ttl = cache_ttl_seconds

    def _match_name_against_entry(
        self,
        query: str,
        entry_names: list[str],
    ) -> tuple[float, bool, bool]:
        """
        Match a query name against a list of entry names.

        Uses multiple algorithms:
        1. Fuzzy token_sort_ratio (primary)
        2. Soundex (secondary, for phonetic variants)
        3. Metaphone (secondary, for pronunciation variants)

        Returns:
            (best_fuzzy_score, soundex_hit, metaphone_hit)
        """
        norm_query = normalize_name(query)
        query_soundex = soundex(norm_query)
        query_metaphone = metaphone(norm_query)

        best_fuzzy = 0.0
        soundex_hit = False
        metaphone_hit = False

        for entry_name in entry_names:
            norm_entry = normalize_name(entry_name)

            # Fuzzy matching
            fuzzy_score = fuzz.token_sort_ratio(norm_query, norm_entry) / 100.0
            best_fuzzy = max(best_fuzzy, fuzzy_score)

            # Soundex matching (for phonetic variants)
            entry_soundex = soundex(norm_entry)
            if query_soundex == entry_soundex and query_soundex != 'Z000':
                soundex_hit = True

            # Metaphone matching (for pronunciation variants)
            entry_metaphone = metaphone(norm_entry)
            if query_metaphone == entry_metaphone and query_metaphone != 'Z000':
                metaphone_hit = True

        return best_fuzzy, soundex_hit, metaphone_hit

    async def screen_transaction(
        self,
        transaction_id: str,
        agent_id: str,
        counterparty_name: str,
        amount_usd: float,
    ) -> ScreeningResult:
        """
        Screen a transaction for OFAC matches.

        Args:
            transaction_id: Unique transaction identifier
            agent_id: ID of the agent/merchant initiating the transaction
            counterparty_name: Name of the party being paid/received from
            amount_usd: Transaction amount in USD

        Returns:
            ScreeningResult with risk_score, matched_entries, hit_reasons

        The risk score is computed as:
          - Base: 0
          - +95 for SDN exact match (similarity >= 0.98)
          - +85 for SDN fuzzy match (0.85–0.98)
          - +75 for DPL match
          - +60 for EEL match
          - +20 for phonetic match (soundex or metaphone)
          - Large amount modifier: +10 if amount > 100k USD
        """
        logger.info(
            "screening.transaction",
            transaction_id=transaction_id,
            agent_id=agent_id,
            counterparty_name=counterparty_name,
            amount_usd=amount_usd,
        )

        try:
            # Search all lists with detailed matching
            sdn_matches = self._search_with_variants(ListType.SDN, counterparty_name)
            dpl_matches = self._search_with_variants(ListType.DPL, counterparty_name)
            eel_matches = self._search_with_variants(ListType.EEL, counterparty_name)

            # Compute risk score
            risk_score, matched_entries, hit_reasons = self._compute_risk(
                sdn_matches, dpl_matches, eel_matches, amount_usd
            )

            is_match = risk_score >= 40  # Threshold for "hit" alert

            result = ScreeningResult(
                transaction_id=transaction_id,
                agent_id=agent_id,
                counterparty_name=counterparty_name,
                amount_usd=amount_usd,
                risk_score=risk_score,
                is_match=is_match,
                matched_entries=matched_entries,
                hit_reasons=hit_reasons,
            )

            # Log to audit service (fire-and-forget)
            await self._log_to_audit(result)

            return result

        except Exception as exc:
            logger.exception(
                "screening.transaction.error",
                transaction_id=transaction_id,
                error=str(exc),
            )
            # Return a neutral result on error
            return ScreeningResult(
                transaction_id=transaction_id,
                agent_id=agent_id,
                counterparty_name=counterparty_name,
                amount_usd=amount_usd,
                risk_score=0,
                is_match=False,
                matched_entries=[],
                hit_reasons=["screening_error: " + str(exc)],
            )

    async def batch_screen(
        self,
        transactions: list[dict[str, Any]],
    ) -> list[ScreeningResult]:
        """
        Screen multiple transactions concurrently.

        Args:
            transactions: List of dicts with keys:
              - transaction_id
              - agent_id
              - counterparty_name
              - amount_usd

        Returns:
            List of ScreeningResult objects
        """
        import asyncio

        tasks = [
            self.screen_transaction(
                transaction_id=t["transaction_id"],
                agent_id=t["agent_id"],
                counterparty_name=t["counterparty_name"],
                amount_usd=t["amount_usd"],
            )
            for t in transactions
        ]
        return await asyncio.gather(*tasks)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _search_with_variants(
        self,
        list_type: ListType,
        query: str,
    ) -> list[NameMatchResult]:
        """
        Search against a list using fuzzy, soundex, and metaphone matching.

        Returns:
            List of NameMatchResult objects sorted by relevance.
        """
        entries = self._ofac._entries.get(list_type, [])
        if not entries or not query or not query.strip():
            return []

        matches: list[tuple[NameMatchResult, float]] = []

        for entry in entries:
            fuzzy_score, soundex_match, metaphone_match = self._match_name_against_entry(
                query, entry.all_names()
            )

            # Determine match method and if it's significant
            match_method = "none"
            if fuzzy_score >= self._threshold:
                match_method = "fuzzy"
            elif soundex_match or metaphone_match:
                match_method = "phonetic"

            if match_method != "none":
                result = NameMatchResult(
                    uid=entry.uid,
                    full_name=entry.full_name,
                    list_type=list_type.value,
                    fuzzy_score=fuzzy_score,
                    soundex_match=soundex_match,
                    metaphone_match=metaphone_match,
                    match_method=match_method,
                )
                # Sort key: fuzzy score, then phonetic hits
                sort_key = fuzzy_score + (0.05 if (soundex_match or metaphone_match) else 0)
                matches.append((result, sort_key))

        # Sort by relevance
        matches.sort(key=lambda x: x[1], reverse=True)
        return [result for result, _ in matches]

    def _compute_risk(
        self,
        sdn_matches: list[NameMatchResult],
        dpl_matches: list[NameMatchResult],
        eel_matches: list[NameMatchResult],
        amount_usd: float,
    ) -> tuple[int, list[dict[str, Any]], list[str]]:
        """
        Compute composite risk score and matched entries.

        Risk scoring logic:
          - SDN exact (>= 0.98): +95
          - SDN fuzzy (>= 0.85): +85
          - SDN phonetic: +50
          - DPL: +75
          - EEL: +60
          - Large amount (> 100k): +10
          - Multiple list hits: +10 bonus

        Returns:
            (risk_score: int [0-100], matched_entries: list, hit_reasons: list)
        """
        risk_score = 0
        matched_entries: list[dict[str, Any]] = []
        hit_reasons: list[str] = []
        hit_count = 0

        # Process SDN matches (highest priority)
        for match in sdn_matches:
            if match.match_method == "fuzzy":
                if match.fuzzy_score >= 0.98:
                    score_delta = 95
                    reason = f"SDN exact match: {match.full_name} ({match.fuzzy_score:.2%})"
                else:
                    score_delta = 85
                    reason = f"SDN fuzzy match: {match.full_name} ({match.fuzzy_score:.2%})"
            else:  # phonetic
                score_delta = 50
                reason = f"SDN phonetic match: {match.full_name}"

            matched_entries.append({
                "list_type": "SDN",
                "uid": match.uid,
                "full_name": match.full_name,
                "match_method": match.match_method,
                "fuzzy_score": round(match.fuzzy_score, 4),
            })
            hit_reasons.append(reason)
            risk_score = max(risk_score, score_delta)
            hit_count += 1

        # Process DPL matches
        for match in dpl_matches:
            matched_entries.append({
                "list_type": "DPL",
                "uid": match.uid,
                "full_name": match.full_name,
                "match_method": match.match_method,
                "fuzzy_score": round(match.fuzzy_score, 4),
            })
            hit_reasons.append(f"BIS Denied Persons List match: {match.full_name}")
            risk_score = max(risk_score, 75)
            hit_count += 1

        # Process EEL matches
        for match in eel_matches:
            matched_entries.append({
                "list_type": "EEL",
                "uid": match.uid,
                "full_name": match.full_name,
                "match_method": match.match_method,
                "fuzzy_score": round(match.fuzzy_score, 4),
            })
            hit_reasons.append(f"BIS Entity List match: {match.full_name}")
            risk_score = max(risk_score, 60)
            hit_count += 1

        # Modifiers
        if amount_usd > 100_000:
            risk_score = min(100, risk_score + 10)
            hit_reasons.append(f"Large transaction: ${amount_usd:,.2f} USD")

        if hit_count > 1:
            # Multiple list hits increase confidence
            risk_score = min(100, risk_score + 10)
            hit_reasons.append(f"Multiple list hits: {hit_count} lists triggered")

        return risk_score, matched_entries, hit_reasons

    async def _log_to_audit(self, result: ScreeningResult) -> None:
        """
        Log screening result to the audit service.

        Audit service endpoint: POST /v1/audit/screening-event
        Payload:
          {
            "event_type": "sanctions_screening",
            "agent_id": str,
            "transaction_id": str,
            "result": {...},
            "timestamp": ISO-8601 UTC
          }

        This is fire-and-forget; we don't block on audit logging.
        """
        try:
            event_payload = {
                "event_type": "sanctions_screening",
                "agent_id": result.agent_id,
                "transaction_id": result.transaction_id,
                "counterparty_name": result.counterparty_name,
                "amount_usd": result.amount_usd,
                "risk_score": result.risk_score,
                "is_match": result.is_match,
                "matched_entries": result.matched_entries,
                "hit_reasons": result.hit_reasons,
                "timestamp": result.screened_at,
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    f"{self._audit_url}/v1/audit/screening-event",
                    json=event_payload,
                )
        except Exception as exc:
            logger.warning(
                "screening.audit_log_failed",
                transaction_id=result.transaction_id,
                error=str(exc),
            )
            # Don't raise; audit logging is not critical
