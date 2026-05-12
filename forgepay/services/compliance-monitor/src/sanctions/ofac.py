"""
OFAC SDN (Specially Designated Nationals) list manager.

Downloads and parses the official OFAC SDN XML from Treasury.gov.
Provides fuzzy name search and crypto-address lookup.

Real OFAC XML schema reference:
    https://home.treasury.gov/system/files/126/sdn_advanced_notes.pdf
    Root: <sdnList>
      <publshInformation>
      <sdnEntry>
        <uid>          — numeric entry ID
        <lastName>     — primary name (last name / entity name)
        <firstName>    — given name (for individuals; absent for entities)
        <sdnType>      — "Individual" | "Entity" | "Vessel" | "Aircraft"
        <programList>
          <program>    — e.g. "SDGT", "IRAN", "CYBER"
        <akaList>
          <aka>
            <type>     — "a.k.a." | "f.k.a." | "n.k.a."
            <lastName>
            <firstName>
        <idList>
          <id>
            <idType>   — e.g. "Digital Currency Address - ETH"
            <idNumber>  — the actual address / passport / etc.
        <addressList>
          <address>
            <country>
"""

from __future__ import annotations

import re
import string
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

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

# ---------------------------------------------------------------------------
# SDN XML namespace (Treasury uses a default namespace in their XML)
# ---------------------------------------------------------------------------
_SDN_NS = ""  # OFAC SDN XML does NOT use a namespace prefix — no ns needed

# Words to strip when normalising entity names for matching
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


# ---------------------------------------------------------------------------
# Internal data structures
# ---------------------------------------------------------------------------

@dataclass
class _SdnEntry:
    uid: str
    primary_name: str
    sdn_type: str                          # Individual | Entity | Vessel | Aircraft
    programs: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    crypto_addresses: list[str] = field(default_factory=list)
    addresses: list[dict[str, str]] = field(default_factory=list)
    additional_info: dict[str, Any] = field(default_factory=dict)

    @property
    def all_names(self) -> list[str]:
        """Primary name + all alias names."""
        return [self.primary_name] + self.aliases


# ---------------------------------------------------------------------------
# Helper: name normalisation
# ---------------------------------------------------------------------------

def _normalise(name: str) -> str:
    """Lowercase, strip punctuation, remove noise words, collapse whitespace."""
    lower = name.lower()
    no_punct = _PUNCT_RE.sub(" ", lower)
    tokens = [t for t in no_punct.split() if t and t not in _NOISE_WORDS]
    return " ".join(tokens)


def _build_name(last: str | None, first: str | None) -> str:
    parts = [p for p in (first, last) if p]
    return " ".join(parts).strip()


# ---------------------------------------------------------------------------
# OfacListManager
# ---------------------------------------------------------------------------

class OfacListManager:
    """
    Manages an in-memory copy of the OFAC SDN list.

    Thread-safety: list replacement is atomic (single dict swap) so reads
    during refresh see either old or new data, never a partial state.
    """

    def __init__(self, sdn_url: str) -> None:
        self._sdn_url = sdn_url
        self._entries: list[_SdnEntry] = []
        # Name-token index: normalised token → list of entry indices for fast pre-filtering
        self._token_index: dict[str, list[int]] = {}
        # Crypto-address index: lowercase address → entry index
        self._crypto_index: dict[str, int] = {}
        self._last_updated: float = 0.0  # unix timestamp

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def refresh_list(self) -> None:
        """Download and parse the OFAC SDN XML.  Retries on network failure."""
        logger.info("ofac.refresh_list.start", url=self._sdn_url)
        xml_bytes = await self._download_with_retry()
        entries, token_index, crypto_index = self._parse_xml(xml_bytes)

        # Atomic swap
        self._entries = entries
        self._token_index = token_index
        self._crypto_index = crypto_index
        self._last_updated = time.time()

        logger.info(
            "ofac.refresh_list.done",
            entry_count=len(entries),
            crypto_addresses=len(crypto_index),
        )

    def get_list_age_hours(self) -> float:
        if self._last_updated == 0.0:
            return float("inf")
        return (time.time() - self._last_updated) / 3600.0

    def entry_count(self) -> int:
        return len(self._entries)

    def search(self, name: str, threshold: float = 0.85) -> list[SanctionsMatch]:
        """
        Fuzzy search across all SDN names.

        1. Normalise the query.
        2. Use the token index to find candidate entries (any shared token).
        3. Score each candidate with fuzzywuzzy token_sort_ratio.
        4. Return matches with score >= threshold, sorted by score desc.
        """
        from fuzzywuzzy import fuzz  # type: ignore[import-untyped]

        if not name or not name.strip():
            return []

        norm_query = _normalise(name)
        if not norm_query:
            return []

        # Candidate selection via token index
        query_tokens = set(norm_query.split())
        candidate_indices: set[int] = set()
        for token in query_tokens:
            for idx in self._token_index.get(token, []):
                candidate_indices.add(idx)

        # If no exact token overlap, fall back to full scan (rare, handles short names)
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
                        list_name="OFAC_SDN",
                        matched_name=best_name,
                        similarity_score=round(similarity, 4),
                        entry_id=entry.uid,
                        entry_type=entry.sdn_type.lower(),
                        programs=entry.programs,
                        additional_info={
                            "aliases": entry.aliases,
                            "addresses": entry.addresses,
                            **entry.additional_info,
                        },
                    )
                )

        matches.sort(key=lambda m: m.similarity_score, reverse=True)
        return matches

    def check_crypto_address(self, address: str) -> list[SanctionsMatch]:
        """
        Exact-match the given blockchain address against OFAC's
        "DIGITAL CURRENCY ADDRESS" entries in the SDN list.

        Returns a list with 0 or 1 SanctionsMatch (OFAC lists addresses once per entry).
        """
        norm_addr = address.strip().lower()
        idx = self._crypto_index.get(norm_addr)
        if idx is None:
            return []

        entry = self._entries[idx]
        return [
            SanctionsMatch(
                list_name="OFAC_SDN",
                matched_name=address,
                similarity_score=1.0,
                entry_id=entry.uid,
                entry_type=entry.sdn_type.lower(),
                programs=entry.programs,
                additional_info={
                    "primary_name": entry.primary_name,
                    "aliases": entry.aliases,
                    "match_type": "crypto_address_exact",
                },
            )
        ]

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
            resp = await client.get(self._sdn_url)
            resp.raise_for_status()
            return resp.content

    @staticmethod
    def _parse_xml(
        xml_bytes: bytes,
    ) -> tuple[list[_SdnEntry], dict[str, list[int]], dict[str, int]]:
        """
        Parse OFAC SDN XML into internal structures.

        Treasury XML structure (abridged):
          <sdnList>
            <sdnEntry>
              <uid>12345</uid>
              <lastName>AL-SHABAAB</lastName>
              <firstName/>          ← empty for entities
              <sdnType>Entity</sdnType>
              <programList>
                <program>SDGT</program>
              </programList>
              <akaList>
                <aka>
                  <type>a.k.a.</type>
                  <lastName>HARAKAT AL-SHABAAB AL-MUJAHIDIN</lastName>
                  <firstName/>
                </aka>
              </akaList>
              <idList>
                <id>
                  <idType>Digital Currency Address - ETH</idType>
                  <idNumber>0xabcd...</idNumber>
                </id>
              </idList>
              <addressList>
                <address>
                  <country>Somalia</country>
                </address>
              </addressList>
            </sdnEntry>
          </sdnList>
        """
        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as exc:
            logger.error("ofac.xml_parse_error", error=str(exc))
            raise

        # Detect namespace (some Treasury versions wrap in a namespace)
        ns = ""
        tag = root.tag
        if tag.startswith("{"):
            ns = tag[: tag.index("}") + 1]

        def _t(local: str) -> str:
            return f"{ns}{local}"

        entries: list[_SdnEntry] = []
        token_index: dict[str, list[int]] = {}
        crypto_index: dict[str, int] = {}

        for sdn_el in root.iter(_t("sdnEntry")):
            uid_el = sdn_el.find(_t("uid"))
            uid = uid_el.text.strip() if uid_el is not None and uid_el.text else "0"

            last_el = sdn_el.find(_t("lastName"))
            first_el = sdn_el.find(_t("firstName"))
            last = (last_el.text or "").strip() if last_el is not None else ""
            first = (first_el.text or "").strip() if first_el is not None else ""
            primary_name = _build_name(last, first) if first else last

            type_el = sdn_el.find(_t("sdnType"))
            sdn_type = (type_el.text or "Entity").strip() if type_el is not None else "Entity"

            # Programs
            programs: list[str] = []
            prog_list = sdn_el.find(_t("programList"))
            if prog_list is not None:
                for p in prog_list.iter(_t("program")):
                    if p.text:
                        programs.append(p.text.strip())

            # Aliases
            aliases: list[str] = []
            aka_list = sdn_el.find(_t("akaList"))
            if aka_list is not None:
                for aka in aka_list.iter(_t("aka")):
                    aka_last_el = aka.find(_t("lastName"))
                    aka_first_el = aka.find(_t("firstName"))
                    aka_last = (aka_last_el.text or "").strip() if aka_last_el is not None else ""
                    aka_first = (
                        (aka_first_el.text or "").strip() if aka_first_el is not None else ""
                    )
                    aka_name = _build_name(aka_last, aka_first) if aka_first else aka_last
                    if aka_name:
                        aliases.append(aka_name)

            # IDs (crypto addresses, passports, etc.)
            crypto_addresses: list[str] = []
            id_list = sdn_el.find(_t("idList"))
            if id_list is not None:
                for id_el in id_list.iter(_t("id")):
                    id_type_el = id_el.find(_t("idType"))
                    id_num_el = id_el.find(_t("idNumber"))
                    if id_type_el is not None and id_num_el is not None:
                        id_type_text = (id_type_el.text or "").lower()
                        id_num_text = (id_num_el.text or "").strip()
                        if "digital currency address" in id_type_text and id_num_text:
                            crypto_addresses.append(id_num_text)

            # Physical addresses
            addresses: list[dict[str, str]] = []
            addr_list = sdn_el.find(_t("addressList"))
            if addr_list is not None:
                for addr in addr_list.iter(_t("address")):
                    addr_dict: dict[str, str] = {}
                    for child in addr:
                        local = child.tag.replace(ns, "") if ns else child.tag
                        if child.text:
                            addr_dict[local] = child.text.strip()
                    if addr_dict:
                        addresses.append(addr_dict)

            entry = _SdnEntry(
                uid=uid,
                primary_name=primary_name,
                sdn_type=sdn_type,
                programs=programs,
                aliases=aliases,
                crypto_addresses=crypto_addresses,
                addresses=addresses,
            )

            idx = len(entries)
            entries.append(entry)

            # Build token index over all names
            for n in entry.all_names:
                for tok in _normalise(n).split():
                    if tok:
                        token_index.setdefault(tok, []).append(idx)

            # Build crypto address index
            for addr_str in crypto_addresses:
                crypto_index[addr_str.lower()] = idx

        return entries, token_index, crypto_index
