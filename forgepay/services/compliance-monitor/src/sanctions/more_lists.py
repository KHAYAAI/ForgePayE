"""
Additional sanctions lists: UN Security Council consolidated, UK, and South
Africa's Targeted Financial Sanctions (TFS) list.

Same interface as OfacListManager / EuSanctionsManager (refresh_list,
entry_count, get_list_age_hours, search) so ScreeningEngine treats every list
alike, and a list that is configured but empty or stale makes screening
refuse rather than report "clear".

Formats:
  UN_CONSOLIDATED  XML from scsanctions.un.org (CONSOLIDATED_LIST /
                   INDIVIDUALS/INDIVIDUAL and ENTITIES/ENTITY, names in
                   FIRST_NAME..FOURTH_NAME, aliases in *_ALIAS/ALIAS_NAME).
  UK_SANCTIONS     CSV. Column names are configurable because the UK list's
                   publication has changed hands (OFSI consolidated list ->
                   FCDO UK Sanctions List); FORMAT TO CONFIRM against a live
                   file before relying on it.
  ZA_TFS           The Financial Intelligence Centre's TFS list (under s26A of
                   the FIC Act it reflects UN Security Council designations).
                   The file the FIC list is distributed as is an XML dataset:
                   <NewDataSet> with <Table> rows for individuals (FullName,
                   IndividualAlias) and <Table1> rows for entities (FirstName
                   holds the name, EntityAlias), each with a ReferenceNumber.
                   Parsed by parse_un_dataset, checked against a full copy of
                   the file (1,002 entries). A CSV is still accepted, with
                   configurable columns, and the format is detected from the
                   file. The download ADDRESS is not established in this repo:
                   set ZA_TFS_URL from the FIC.

None of these files is downloaded in tests or at build time; parsers are
tested against small hand-written fixtures.
"""

from __future__ import annotations

import csv
import io
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import structlog

from src.models import SanctionsMatch
from src.sanctions.eu_list import _normalise

logger = structlog.get_logger(__name__)


@dataclass
class ListEntry:
    entry_id: str
    primary_name: str
    entry_type: str
    programs: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)

    @property
    def all_names(self) -> list[str]:
        return [self.primary_name, *self.aliases]


Parser = Callable[[bytes], list[ListEntry]]


def _text(el: ET.Element | None) -> str:
    return (el.text or "").strip() if el is not None else ""


def parse_un_consolidated(data: bytes) -> list[ListEntry]:
    root = ET.fromstring(data)
    out: list[ListEntry] = []
    for ind in root.iter("INDIVIDUAL"):
        name = " ".join(p for p in (_text(ind.find(t)) for t in ("FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME")) if p)
        if not name:
            continue
        aliases = [_text(a.find("ALIAS_NAME")) for a in ind.iter("INDIVIDUAL_ALIAS")]
        out.append(ListEntry(
            entry_id=_text(ind.find("REFERENCE_NUMBER")) or _text(ind.find("DATAID")),
            primary_name=name, entry_type="individual",
            programs=[p for p in [_text(ind.find("UN_LIST_TYPE"))] if p],
            aliases=[a for a in aliases if a],
        ))
    for ent in root.iter("ENTITY"):
        name = _text(ent.find("FIRST_NAME"))
        if not name:
            continue
        aliases = [_text(a.find("ALIAS_NAME")) for a in ent.iter("ENTITY_ALIAS")]
        out.append(ListEntry(
            entry_id=_text(ent.find("REFERENCE_NUMBER")) or _text(ent.find("DATAID")),
            primary_name=name, entry_type="entity",
            programs=[p for p in [_text(ent.find("UN_LIST_TYPE"))] if p],
            aliases=[a for a in aliases if a],
        ))
    return out


def _clean(value: str) -> str:
    return " ".join(value.split())


def _alias(value: str) -> str:
    """Dataset aliases carry a quality label in front ("Good, Jang Chang Ha", "Low, ..."); the label is not part of the name."""
    value = _clean(value)
    for label in ("Good,", "Low,", "good,", "low,"):
        if value.startswith(label):
            return value[len(label):].strip()
    return value


def parse_un_dataset(data: bytes) -> list[ListEntry]:
    """
    The XML dataset layout: <Table> rows are individuals (FullName, IndividualAlias), <Table1> rows are entities (FirstName
    is the entity's name, EntityAlias). A row with no name is not an entry.
    """
    root = ET.fromstring(data)
    out: list[ListEntry] = []
    for row in root:
        if row.tag == "Table":
            name, alias_tag, kind = _clean(_text(row.find("FullName"))), "IndividualAlias", "individual"
        elif row.tag == "Table1":
            name, alias_tag, kind = _clean(_text(row.find("FirstName"))), "EntityAlias", "entity"
        else:
            continue
        ref = _clean(_text(row.find("ReferenceNumber")))
        if not name or not ref:
            continue
        aliases = [a for a in (_alias(_text(el)) for el in row.findall(alias_tag)) if a and a != name]
        out.append(ListEntry(
            entry_id=ref, primary_name=name, entry_type=kind,
            programs=[ref[:2]] if len(ref) >= 2 else [], aliases=aliases,
        ))
    return out


def detecting_parser(csv_parse: Parser) -> Parser:
    """XML files go to the dataset parser, anything else to the CSV parser."""
    def parse(data: bytes) -> list[ListEntry]:
        head = data.lstrip(b"\xef\xbb\xbf \t\r\n")[:1]
        return parse_un_dataset(data) if head == b"<" else csv_parse(data)
    return parse


def csv_parser(name_columns: list[str], id_column: str, type_column: str | None = None,
               program_column: str | None = None, skip_rows: int = 0) -> Parser:
    """
    A parser for a CSV list. A row's name is its non-empty name_columns
    joined with spaces; rows sharing an id are one entry (first name primary,
    the rest aliases), which is how list CSVs usually carry aliases.
    """
    def parse(data: bytes) -> list[ListEntry]:
        text = data.decode("utf-8-sig", errors="replace")
        lines = text.splitlines()[skip_rows:]
        by_id: dict[str, ListEntry] = {}
        for row in csv.DictReader(io.StringIO("\n".join(lines))):
            name = " ".join((row.get(c) or "").strip() for c in name_columns if (row.get(c) or "").strip())
            entry_id = (row.get(id_column) or "").strip()
            if not name or not entry_id:
                continue
            existing = by_id.get(entry_id)
            if existing is None:
                by_id[entry_id] = ListEntry(
                    entry_id=entry_id, primary_name=name,
                    entry_type=((row.get(type_column) or "").strip().lower() if type_column else "") or "unknown",
                    programs=[p for p in [(row.get(program_column) or "").strip() if program_column else ""] if p],
                )
            elif name != existing.primary_name and name not in existing.aliases:
                existing.aliases.append(name)
        return list(by_id.values())
    return parse


class NamedListManager:
    """In-memory copy of one sanctions list, refreshed from its URL."""

    def __init__(self, list_name: str, url: str | None, parser: Parser) -> None:
        self.list_name = list_name
        self.url = url
        self._parser = parser
        self._entries: list[ListEntry] = []
        self._token_index: dict[str, list[int]] = {}
        self._last_updated = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.url)

    def load(self, data: bytes) -> None:
        """Replace the list from raw file bytes (used by refresh_list and tests)."""
        entries = self._parser(data)
        index: dict[str, list[int]] = {}
        for i, e in enumerate(entries):
            for n in e.all_names:
                for tok in set(_normalise(n).split()):
                    index.setdefault(tok, []).append(i)
        if not entries:
            # An empty parse is a format problem, not "nobody is sanctioned".
            raise ValueError(f"{self.list_name}: parsed 0 entries; refusing to replace the list")
        self._entries, self._token_index, self._last_updated = entries, index, time.time()

    async def refresh_list(self) -> None:
        if not self.url:
            return
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            resp = await client.get(self.url)
            resp.raise_for_status()
        self.load(resp.content)
        logger.info("sanctions_list.refreshed", list=self.list_name, entries=len(self._entries))

    def entry_count(self) -> int:
        return len(self._entries)

    def get_list_age_hours(self) -> float:
        return float("inf") if self._last_updated == 0.0 else (time.time() - self._last_updated) / 3600.0

    def search(self, name: str, threshold: float = 0.85) -> list[SanctionsMatch]:
        from fuzzywuzzy import fuzz  # type: ignore[import-untyped]

        q = _normalise(name or "")
        if not q:
            return []
        candidates: set[int] = set()
        for tok in q.split():
            candidates.update(self._token_index.get(tok, []))
        matches: list[SanctionsMatch] = []
        for i in candidates:
            e = self._entries[i]
            best, best_name = 0, ""
            for n in e.all_names:
                s = fuzz.token_sort_ratio(q, _normalise(n))
                if s > best:
                    best, best_name = s, n
            if best / 100.0 >= threshold:
                matches.append(SanctionsMatch(
                    list_name=self.list_name, matched_name=best_name, similarity_score=round(best / 100.0, 4),
                    entry_id=e.entry_id, entry_type=e.entry_type, programs=e.programs,
                    additional_info={"aliases": e.aliases},
                ))
        matches.sort(key=lambda m: m.similarity_score, reverse=True)
        return matches


def _cols(value: str) -> list[str]:
    return [c.strip() for c in value.split(",") if c.strip()]


def build_additional_lists(settings: Any) -> list[NamedListManager]:
    """The UN, UK and ZA list managers as configured (unconfigured ones have url None)."""
    cols = _cols
    return [
        NamedListManager("UN_CONSOLIDATED", settings.un_sanctions_url, parse_un_consolidated),
        NamedListManager("UK_SANCTIONS", settings.uk_sanctions_url, csv_parser(
            cols(settings.uk_sanctions_name_columns), settings.uk_sanctions_id_column,
            settings.uk_sanctions_type_column, settings.uk_sanctions_program_column, settings.uk_sanctions_skip_rows)),
        NamedListManager("ZA_TFS", settings.za_tfs_url, detecting_parser(csv_parser(
            cols(settings.za_tfs_name_columns), settings.za_tfs_id_column,
            settings.za_tfs_type_column, None, settings.za_tfs_skip_rows))),
    ]


def za_tfs_required(settings: Any) -> bool:
    if settings.require_za_tfs is not None:
        return bool(settings.require_za_tfs)
    return bool(settings.environment == "production")
