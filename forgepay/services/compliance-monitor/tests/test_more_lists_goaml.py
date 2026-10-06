"""
UN / UK / ZA sanctions lists and goAML report drafts.

Fixtures below are tiny hand-written files with obviously fake names. The
UN layout follows the published consolidated XML; the UK and ZA CSV layouts
are configurable and must be confirmed against live files.
"""

from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET

import pytest

from src.config import get_settings
from src.models import CtrReport, SarReport
from src.reporting.goaml import build_ctr, build_str
from src.sanctions.more_lists import (
    NamedListManager,
    csv_parser,
    parse_un_consolidated,
    za_tfs_required,
)
from src.screening.engine import ScreeningEngine

UN_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>1</DATAID><REFERENCE_NUMBER>QDi.999</REFERENCE_NUMBER>
      <FIRST_NAME>TESTPERSON</FIRST_NAME><SECOND_NAME>EXAMPLEVILLE</SECOND_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
      <INDIVIDUAL_ALIAS><ALIAS_NAME>T. Exampleville</ALIAS_NAME></INDIVIDUAL_ALIAS>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>2</DATAID><REFERENCE_NUMBER>QDe.998</REFERENCE_NUMBER>
      <FIRST_NAME>FAKE FRONT TRADING</FIRST_NAME><UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>"""

UK_CSV = b"""Last Updated,01/10/2026
Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Group ID,Group Type,Regime
DOEFAKE,JOHN,,,,,12345,Individual,Testland
DOEFAKE,JOHNNY,,,,,12345,Individual,Testland
"""

ZA_CSV = b"""Reference Number,Full Name
ZA-TFS-0001,Fictional Sanctioned Entity
"""


def test_un_parser_reads_individuals_entities_and_aliases() -> None:
    entries = parse_un_consolidated(UN_XML)
    assert {e.primary_name for e in entries} == {"TESTPERSON EXAMPLEVILLE", "FAKE FRONT TRADING"}
    person = next(e for e in entries if e.entry_type == "individual")
    assert person.entry_id == "QDi.999" and person.aliases == ["T. Exampleville"]


def test_uk_csv_groups_rows_by_id_as_aliases() -> None:
    parse = csv_parser(["Name 1", "Name 2", "Name 3", "Name 4", "Name 5", "Name 6"], "Group ID", "Group Type", "Regime", skip_rows=1)
    [entry] = parse(UK_CSV)
    assert entry.primary_name == "JOHN DOEFAKE" and entry.aliases == ["JOHNNY DOEFAKE"]
    assert entry.programs == ["Testland"] and entry.entry_type == "individual"


def test_list_manager_searches_and_names_its_list() -> None:
    m = NamedListManager("ZA_TFS", "http://example.invalid/tfs.csv", csv_parser(["Full Name"], "Reference Number"))
    m.load(ZA_CSV)
    hits = m.search("Fictional Sanctioned Entity")
    assert hits and hits[0].list_name == "ZA_TFS" and hits[0].entry_id == "ZA-TFS-0001"
    assert m.search("Somebody Else Entirely") == []


def test_a_file_that_parses_to_nothing_does_not_replace_the_list() -> None:
    m = NamedListManager("UN_CONSOLIDATED", "http://x", parse_un_consolidated)
    m.load(UN_XML)
    with pytest.raises(ValueError):
        m.load(b"<CONSOLIDATED_LIST/>")
    assert m.entry_count() == 2


class _Loaded:
    def __init__(self, n: int = 1, age: float = 1.0) -> None:
        self._n, self._age = n, age
    def entry_count(self) -> int: return self._n
    def get_list_age_hours(self) -> float: return self._age
    def search(self, name: str, threshold: float = 0.85): return []
    def check_crypto_address(self, address: str): return []


class _NoRedis:
    async def get(self, *a, **k): return None
    async def setex(self, *a, **k): return None
    async def lpush(self, *a, **k): return None
    async def expire(self, *a, **k): return None
    async def ltrim(self, *a, **k): return None
    async def set(self, *a, **k): return None


def test_a_configured_list_that_has_not_loaded_blocks_clearing() -> None:
    un = NamedListManager("UN_CONSOLIDATED", "http://x", parse_un_consolidated)  # configured, never loaded
    e = ScreeningEngine(_Loaded(), _Loaded(), _NoRedis(), additional_lists=[un])  # type: ignore[arg-type]
    assert asyncio.run(e.screen_entity("e1", "business", "Anyone Ltd")).result == "error"
    un.load(UN_XML)
    assert asyncio.run(e.screen_entity("e2", "business", "Anyone Ltd")).result == "clear"


def test_an_empty_eu_list_now_blocks_clearing_too() -> None:
    e = ScreeningEngine(_Loaded(), _Loaded(n=0), _NoRedis())  # type: ignore[arg-type]
    assert asyncio.run(e.screen_entity("e1", "business", "Anyone Ltd")).result == "error"


def test_a_match_on_an_additional_list_is_reported() -> None:
    un = NamedListManager("UN_CONSOLIDATED", "http://x", parse_un_consolidated)
    un.load(UN_XML)
    e = ScreeningEngine(_Loaded(), _Loaded(), _NoRedis(), additional_lists=[un])  # type: ignore[arg-type]
    r = asyncio.run(e.screen_entity("e1", "business", "Fake Front Trading"))
    assert r.result != "clear" and any(m.list_name == "UN_CONSOLIDATED" for m in r.matches)


def test_za_tfs_is_required_in_production_unless_overridden(monkeypatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "require_za_tfs", None)
    monkeypatch.setattr(s, "environment", "production")
    assert za_tfs_required(s) is True
    monkeypatch.setattr(s, "environment", "development")
    assert za_tfs_required(s) is False


SAR = SarReport(
    id="sar-1", merchant_id="m-1", transaction_ids=["tx-1", "tx-2"], filing_type="initial", status="draft",
    activity_description="Structured deposits just under the threshold.", suspicious_activity_type=["structuring"],
    total_amount=98000.0, activity_start_date="2026-09-01", activity_end_date="2026-09-30", created_at="2026-10-01",
)


def test_str_draft_carries_the_sar_and_says_it_is_not_filed() -> None:
    xml = build_str(SAR, rentity_id="12345", approved_by="Officer Example")
    root = ET.fromstring(xml)
    assert root.findtext("report_code") == "STR" and root.findtext("rentity_id") == "12345"
    assert root.findtext("reason") == SAR.activity_description
    assert [t.findtext("transactionnumber") for t in root.findall("transaction")] == ["tx-1", "tx-2"]
    assert "Not submitted" in xml and "Not validated against the FIC goAML XSD" in xml


def test_ctr_draft_respects_the_configured_threshold() -> None:
    ctr = CtrReport(id="c-1", merchant_id="m-1", transaction_id="tx-9", amount=60000.0, currency="ZAR",
                    transaction_date="2026-10-01", filing_status="pending", created_at="2026-10-01")
    root = ET.fromstring(build_ctr(ctr, rentity_id="12345", approved_by="Officer", threshold_zar=49_999.99))
    assert root.findtext("report_code") == "CTR" and root.find("transaction").findtext("amount_local") == "60000.00"
    with pytest.raises(ValueError):
        build_ctr(ctr.model_copy(update={"amount": 1000.0}), rentity_id="1", approved_by="O", threshold_zar=49_999.99)


# ── South Africa TFS: the XML dataset the FIC list is distributed as ──────────
# tests/fixtures/fic_tfs_dataset_sample.xml is five rows trimmed from a full copy of the file (1,002 entries when parsed in
# full): <Table> rows are individuals, <Table1> rows are entities whose name is in FirstName.

def _sample() -> bytes:
    from pathlib import Path

    return (Path(__file__).parent / "fixtures" / "fic_tfs_dataset_sample.xml").read_bytes()


def test_za_dataset_parses_individuals_entities_and_aliases():
    from src.sanctions.more_lists import parse_un_dataset

    entries = parse_un_dataset(_sample())
    assert [e.entry_type for e in entries] == ["individual"] * 3 + ["entity"] * 2
    ri = next(e for e in entries if e.entry_id == "KPi.033")
    assert ri.primary_name == "RI WON HO"
    assert ri.programs == ["KP"]
    chang = next(e for e in entries if e.entry_id == "KPi.037")
    assert "Jang Chang Ha" in chang.aliases and not any(a.startswith("Good") for a in chang.aliases)  # quality label dropped


def test_za_list_detects_xml_and_still_accepts_csv():
    from src.sanctions.more_lists import NamedListManager, csv_parser, detecting_parser

    parser = detecting_parser(csv_parser(["Full Name"], "Reference Number"))
    xml_list = NamedListManager("ZA_TFS", "x", parser)
    xml_list.load(_sample())
    assert xml_list.entry_count() == 5
    assert [m.entry_id for m in xml_list.search("Ri Won Ho")] == ["KPi.033"]
    assert xml_list.search("Entirely Unrelated Person") == []

    csv_list = NamedListManager("ZA_TFS", "x", parser)
    csv_list.load(b"Full Name,Reference Number\nJane Doe,ZA.1\n")
    assert csv_list.entry_count() == 1


def test_za_dataset_with_no_named_rows_is_refused_not_treated_as_empty_list():
    import pytest

    from src.sanctions.more_lists import NamedListManager, csv_parser, detecting_parser

    m = NamedListManager("ZA_TFS", "x", detecting_parser(csv_parser(["Full Name"], "Reference Number")))
    with pytest.raises(ValueError):
        m.load(b"<NewDataSet><Table><ReferenceNumber>X</ReferenceNumber></Table></NewDataSet>")
