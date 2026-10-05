"""
goAML report drafts for South Africa's Financial Intelligence Centre (FIC).

Builds STR (suspicious transaction report, from a SAR record) and CTR (cash
threshold report) drafts in a goAML-style XML layout, for a compliance
officer to review, export, and upload to the FIC's goAML portal themselves.

What this does NOT do:
  - submit anything. Filing is a human action in goAML, under the
    accountable institution's own registration (FIC_RENTITY_ID). Nothing in
    this service talks to the FIC.
  - guarantee schema validity. The element layout follows goAML's general
    report structure (report / rentity_id / submission_code / report_code /
    reason / transaction...) but has NOT been validated against the FIC's
    published goAML XSD. Validate every export against the current XSD
    before upload; treat this as a draft.
  - decide thresholds. The CTR threshold is configurable (ZA_CTR_THRESHOLD_ZAR)
    and must be confirmed against the current regulations under s28 of the
    FIC Act.

Every export records who approved it and when (goaml_exports table).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from src.models import CtrReport, SarReport

SCHEMA_NOTE = (
    "Draft in goAML-style layout. Not validated against the FIC goAML XSD; "
    "validate before upload. Not submitted: filing is done by a compliance officer in the goAML portal."
)


def _sub(parent: ET.Element, tag: str, text: str | None = None) -> ET.Element:
    el = ET.SubElement(parent, tag)
    if text is not None:
        el.text = text
    return el


def _header(report_code: str, rentity_id: str, approved_by: str, local_currency: str) -> ET.Element:
    root = ET.Element("report")
    root.append(ET.Comment(SCHEMA_NOTE))
    _sub(root, "rentity_id", rentity_id or "UNSET")
    _sub(root, "submission_code", "E")  # electronic
    _sub(root, "report_code", report_code)
    _sub(root, "submission_date", datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S"))
    _sub(root, "currency_code_local", local_currency)
    person = _sub(root, "reporting_person")
    _sub(person, "full_name", approved_by)
    return root


def build_str(sar: SarReport, *, rentity_id: str, approved_by: str, local_currency: str = "ZAR") -> str:
    """STR draft from a SAR record (its narrative, period, amount and transactions)."""
    root = _header("STR", rentity_id, approved_by, local_currency)
    _sub(root, "entity_reference", sar.id)
    _sub(root, "reason", sar.activity_description)
    _sub(root, "action", "Draft prepared from FORGE compliance-monitor; review before filing.")
    ind = _sub(root, "report_indicators")
    for code in sar.suspicious_activity_type:
        _sub(ind, "indicator", code)
    activity = _sub(root, "activity")
    _sub(activity, "start_date", sar.activity_start_date)
    _sub(activity, "end_date", sar.activity_end_date)
    _sub(activity, "total_amount", f"{sar.total_amount:.2f}")
    _sub(activity, "merchant_reference", sar.merchant_id)
    for tx_id in sar.transaction_ids:
        tx = _sub(root, "transaction")
        _sub(tx, "transactionnumber", tx_id)
    return ET.tostring(root, encoding="unicode")


def build_ctr(ctr: CtrReport, *, rentity_id: str, approved_by: str, threshold_zar: float, local_currency: str = "ZAR") -> str:
    """CTR draft for one cash transaction at or above the configured threshold."""
    if ctr.currency.upper() == "ZAR" and ctr.amount < threshold_zar:
        raise ValueError(f"amount {ctr.amount:.2f} ZAR is below the configured CTR threshold {threshold_zar:.2f}")
    root = _header("CTR", rentity_id, approved_by, local_currency)
    _sub(root, "entity_reference", ctr.id)
    tx = _sub(root, "transaction")
    _sub(tx, "transactionnumber", ctr.transaction_id)
    _sub(tx, "date_transaction", ctr.transaction_date)
    _sub(tx, "amount_local" if ctr.currency.upper() == local_currency else "amount_foreign", f"{ctr.amount:.2f}")
    _sub(tx, "currency_code", ctr.currency.upper())
    _sub(tx, "transmode_code", "C")  # cash
    _sub(tx, "merchant_reference", ctr.merchant_id)
    return ET.tostring(root, encoding="unicode")
