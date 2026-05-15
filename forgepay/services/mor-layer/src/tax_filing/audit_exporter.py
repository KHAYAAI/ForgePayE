"""
Tax Compliance Audit Exporter.

Generates compliance reports for merchants and tax authorities.
Outputs: JSON, CSV, and plain-text formats.
"""
from dataclasses import dataclass
from datetime import datetime, date
from typing import Optional
import csv
import io
import json
import logging

logger = logging.getLogger(__name__)


@dataclass
class AuditReport:
    merchant_id: str
    period: str
    period_start: date
    period_end: date
    total_revenue: float
    total_tax_collected: float
    total_tax_remitted: float
    tax_liability_remaining: float
    transaction_count: int
    jurisdictions_count: int
    generated_at: datetime
    format: str  # "json" | "csv" | "summary"
    content: str  # The actual report content


def generate_summary_report(
    merchant_id: str,
    period: str,
    period_start: date,
    period_end: date,
    transactions: list[dict],
) -> AuditReport:
    """Generate a human-readable tax summary report."""
    total_revenue = sum(t.get("amount", 0) for t in transactions)
    total_tax = sum(t.get("tax_amount", 0) for t in transactions)
    jurisdictions = set(t.get("jurisdiction", "UNKNOWN") for t in transactions)

    content = f"""
ForgePay Tax Compliance Report
================================
Merchant ID: {merchant_id}
Period: {period} ({period_start} to {period_end})
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}

SUMMARY
-------
Total Revenue:        ${total_revenue:>12,.2f}
Total Tax Collected:  ${total_tax:>12,.2f}
Tax Rate (avg):       {(total_tax/total_revenue*100 if total_revenue else 0):>11.2f}%
Transactions:         {len(transactions):>12,d}
Jurisdictions:        {len(jurisdictions):>12,d}

TAX BY JURISDICTION
-------------------
""".strip()

    # Group by jurisdiction
    by_jurisdiction: dict[str, dict] = {}
    for txn in transactions:
        j = txn.get("jurisdiction", "UNKNOWN")
        if j not in by_jurisdiction:
            by_jurisdiction[j] = {"revenue": 0, "tax": 0, "count": 0}
        by_jurisdiction[j]["revenue"] += txn.get("amount", 0)
        by_jurisdiction[j]["tax"] += txn.get("tax_amount", 0)
        by_jurisdiction[j]["count"] += 1

    for jurisdiction, data in sorted(
        by_jurisdiction.items(), key=lambda x: x[1]["tax"], reverse=True
    ):
        content += (
            f"\n{jurisdiction:<6} Revenue: ${data['revenue']:>10,.2f}"
            f"  Tax: ${data['tax']:>8,.2f}  ({data['count']} txns)"
        )

    content += (
        "\n\nNOTE: This report is for informational purposes. "
        "ForgePay files taxes on your behalf (Standard tier)."
    )

    return AuditReport(
        merchant_id=merchant_id,
        period=period,
        period_start=period_start,
        period_end=period_end,
        total_revenue=total_revenue,
        total_tax_collected=total_tax,
        total_tax_remitted=total_tax * 0.95,  # Assume 95% remitted (5% pending)
        tax_liability_remaining=total_tax * 0.05,
        transaction_count=len(transactions),
        jurisdictions_count=len(jurisdictions),
        generated_at=datetime.now(),
        format="summary",
        content=content,
    )


def generate_csv_report(
    merchant_id: str,
    period: str,
    period_start: date,
    period_end: date,
    transactions: list[dict],
) -> AuditReport:
    """Generate a CSV compliance report for import into accounting software."""
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "transaction_id", "date", "jurisdiction",
        "amount_usd", "tax_amount", "tax_rate", "status",
    ])

    total_revenue = 0.0
    total_tax = 0.0

    for txn in transactions:
        amount = txn.get("amount", 0)
        tax = txn.get("tax_amount", 0)
        total_revenue += amount
        total_tax += tax
        writer.writerow([
            txn.get("id", ""),
            txn.get("date", ""),
            txn.get("jurisdiction", ""),
            f"{amount:.2f}",
            f"{tax:.2f}",
            f"{(tax/amount*100 if amount else 0):.2f}%",
            txn.get("status", "completed"),
        ])

    return AuditReport(
        merchant_id=merchant_id,
        period=period,
        period_start=period_start,
        period_end=period_end,
        total_revenue=total_revenue,
        total_tax_collected=total_tax,
        total_tax_remitted=total_tax,
        tax_liability_remaining=0,
        transaction_count=len(transactions),
        jurisdictions_count=len(set(t.get("jurisdiction") for t in transactions)),
        generated_at=datetime.now(),
        format="csv",
        content=output.getvalue(),
    )


def generate_json_report(
    merchant_id: str,
    period: str,
    period_start: date,
    period_end: date,
    transactions: list[dict],
) -> AuditReport:
    """Generate JSON compliance report for API consumption."""
    by_jurisdiction: dict[str, dict] = {}
    total_revenue = 0.0
    total_tax = 0.0

    for txn in transactions:
        j = txn.get("jurisdiction", "UNKNOWN")
        if j not in by_jurisdiction:
            by_jurisdiction[j] = {"revenue": 0, "tax": 0, "transactions": []}
        amount = txn.get("amount", 0)
        tax = txn.get("tax_amount", 0)
        by_jurisdiction[j]["revenue"] += amount
        by_jurisdiction[j]["tax"] += tax
        by_jurisdiction[j]["transactions"].append(txn)
        total_revenue += amount
        total_tax += tax

    report_data = {
        "merchant_id": merchant_id,
        "period": period,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "total_revenue_usd": round(total_revenue, 2),
            "total_tax_collected_usd": round(total_tax, 2),
            "average_tax_rate": round(total_tax / total_revenue * 100, 2) if total_revenue else 0,
            "transaction_count": len(transactions),
            "jurisdiction_count": len(by_jurisdiction),
        },
        "by_jurisdiction": {
            j: {
                "revenue": round(data["revenue"], 2),
                "tax": round(data["tax"], 2),
                "transaction_count": len(data["transactions"]),
            }
            for j, data in by_jurisdiction.items()
        },
    }

    return AuditReport(
        merchant_id=merchant_id,
        period=period,
        period_start=period_start,
        period_end=period_end,
        total_revenue=total_revenue,
        total_tax_collected=total_tax,
        total_tax_remitted=total_tax,
        tax_liability_remaining=0,
        transaction_count=len(transactions),
        jurisdictions_count=len(by_jurisdiction),
        generated_at=datetime.now(),
        format="json",
        content=json.dumps(report_data, indent=2),
    )
