"""
EU Consolidated Sanctions List manager.

Downloads and parses the EU FSF (Financial Sanctions Files) XML.
Published by the EU Financial Sanctions Unit at DG FISMA.

EU XML schema (FullSanctionsList_1_1):
  <export>
    <sanctionEntity>
      <entity>
        <logicalId>          — numeric ID
        <subjectType>        — "person" | "enterprise" | "other"
        <primaryName>...</primaryName>
        <nameAlias>
          <wholeName>
        <citizenship>
          <countryIso2Code>
        <euReferenceNumber>  — e.g. "EU.5765.16"
      <regulation>
        <programme>          — sanctions programme name
"""

from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx
import structlog
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from src.models import SanctionsMatch

logger = structlog.get_logger(__name__)

_NOISE_WORDS: frozenset[str] = frozenset(
    {
        "inc", "llc", "ltd", "corp", "co", "company", "corporation",
        "limited", "group", "holding", "holdings", "international",
        "enterprises", "solutions", "services", "global", "the", "and",
        "of", "for", "in", "a", "an", "sa", "ag", "bv", "gmbh", "pte",
        "pty", "plc", "llp", "lp", "nv", "spa", "srl", "sas",
    }
)
_PUNCT_RE = re.compile(r"[^\w\s]")


def _normalise(name: str) -> str:
    lower = name.lower()
    no_punct = _PUNCT_RE.sub(" ", lower)
    tokens = [t for t in no_punct.split() if t and t not in _NOISE_WORDS]
    return " ".join(tokens)


@dataclass
class _EuEntry:
    entry_id: str
    primary_name: str
    subject_type: str
    programmes: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    citizenships: list[str] = field(default_factory=list)

    @property
    def all_names(self) -> list[str]:
        return [self.primary_name] + self.aliases


class EuSanctionsManager:
    """
    In-memory cache of the EU Consolidated Sanctions List.

    Refreshed daily (or on demand).  Provides fuzzy name search
    compatible with the ScreeningEngine's parallel search pattern.
    """

    def __init__(self, list_url: str) -> None:
        self._list_url = list_url
        self._entries: list[_EuEntry] = []
        self._token_index: dict[str, list[int]] = {}
        self._last_updated: float = 0.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def refresh_list(self) -> None:
        logger.info("eu_sanctions.refresh_list.start", url=self._list_url)
        xml_bytes = await self._download_with_retry()
        entries, token_index = self._parse_xml(xml_bytes)

        self._entries = entries
        self._token_index = token_index
        self._last_updated = time.time()

        logger.info("eu_sanctions.refresh_list.done", entry_count=len(entries))

    def get_list_age_hours(self) -> float:
        if self._last_updated == 0.0:
            return float("inf")
        return (time.time() - self._last_updated) / 3600.0

    def entry_count(self) -> int:
        return len(self._entries)

    def search(self, name: str, threshold: float = 0.85) -> list[SanctionsMatch]:
        """Fuzzy name search across all EU sanctions entries."""
        from fuzzywuzzy import fuzz  # type: ignore[import-untyped]

        if not name or not name.strip():
            return []

        norm_query = _normalise(name)
        if not norm_query:
            return []

        query_tokens = set(norm_query.split())
        candidate_indices: set[int] = set()
        for token in query_tokens:
            for idx in self._token_index.get(token, []):
                candidate_indices.add(idx)

        if not candidate_indices:
            candidate_indices = set(range(len(self._entries)))

        matches: list[SanctionsMatch] = []
        for idx in candidate_indices:
            entry = self._entries[idx]
            best_score = 0
            best_name = ""
            for alias in entry.all_names:
                norm_alias = _normalise(alias)
                score = fuzz.token_sort_ratio(norm_query, norm_alias)
                if score > best_score:
                    best_score = score
                    best_name = alias

            similarity = best_score / 100.0
            if similarity >= threshold:
                matches.append(
                    SanctionsMatch(
                        list_name="EU_CONSOLIDATED",
                        matched_name=best_name,
                        similarity_score=round(similarity, 4),
                        entry_id=entry.entry_id,
                        entry_type=entry.subject_type,
                        programs=entry.programmes,
                        additional_info={
                            "aliases": entry.aliases,
                            "citizenships": entry.citizenships,
                        },
                    )
                )

        matches.sort(key=lambda m: m.similarity_score, reverse=True)
        return matches

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _download_with_retry(self) -> bytes:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            resp = await client.get(self._list_url)
            resp.raise_for_status()
            return resp.content

    @staticmethod
    def _parse_xml(
        xml_bytes: bytes,
    ) -> tuple[list[_EuEntry], dict[str, list[int]]]:
        """
        Parse EU FullSanctionsList XML.

        The EU XML uses a namespace. Structure (simplified):
          <export xmlns="..." ...>
            <sanctionEntity>
              <entity logicalId="..." subjectType="person">
                <primaryName>...</primaryName>
                <nameAlias wholeName="..."/>
                <citizenship countryIso2Code="RU"/>
              </entity>
              <regulation>
                <programme>UKRAINE</programme>
              </regulation>
            </sanctionEntity>
          </export>
        """
        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            logger.error("eu_sanctions.xml_parse_error", error=str(exc))
            raise

        # Detect namespace
        tag = root.tag
        ns = ""
        if tag.startswith("{"):
            ns = tag[: tag.index("}") + 1]

        def _t(local: str) -> str:
            return f"{ns}{local}"

        entries: list[_EuEntry] = []
        token_index: dict[str, list[int]] = {}

        for sanction_el in root.iter(_t("sanctionEntity")):
            # Extract entity element (may sit directly under sanctionEntity)
            entity_el = sanction_el.find(_t("entity"))

            if entity_el is None:
                continue

            entry_id = entity_el.get("logicalId", "0")
            subject_type = entity_el.get("subjectType", "other").lower()

            # Primary name
            pn_el = entity_el.find(_t("primaryName"))
            primary_name = (pn_el.text or "").strip() if pn_el is not None else ""
            if not primary_name:
                # Fallback: use wholeName from first nameAlias
                first_alias_el = entity_el.find(_t("nameAlias"))
                if first_alias_el is not None:
                    primary_name = first_alias_el.get("wholeName", "").strip()
            if not primary_name:
                continue

            # Aliases
            aliases: list[str] = []
            for alias_el in entity_el.iter(_t("nameAlias")):
                wn = alias_el.get("wholeName", "").strip()
                if wn and wn != primary_name:
                    aliases.append(wn)
                # Some versions nest <wholeName> as child element
                wn_el = alias_el.find(_t("wholeName"))
                if wn_el is not None and wn_el.text:
                    wn2 = wn_el.text.strip()
                    if wn2 and wn2 != primary_name and wn2 not in aliases:
                        aliases.append(wn2)

            # Citizenships
            citizenships: list[str] = []
            for cit_el in entity_el.iter(_t("citizenship")):
                cc = cit_el.get("countryIso2Code", "").strip()
                if not cc:
                    cc_el = cit_el.find(_t("countryIso2Code"))
                    if cc_el is not None and cc_el.text:
                        cc = cc_el.text.strip()
                if cc:
                    citizenships.append(cc.upper())

            # Regulation / programmes
            programmes: list[str] = []
            for reg_el in sanction_el.iter(_t("regulation")):
                for prog_el in reg_el.iter(_t("programme")):
                    if prog_el.text:
                        programmes.append(prog_el.text.strip().upper())

            entry = _EuEntry(
                entry_id=entry_id,
                primary_name=primary_name,
                subject_type=subject_type,
                programmes=programmes,
                aliases=aliases,
                citizenships=citizenships,
            )

            idx = len(entries)
            entries.append(entry)

            for n in entry.all_names:
                for tok in _normalise(n).split():
                    if tok:
                        token_index.setdefault(tok, []).append(idx)

        return entries, token_index
