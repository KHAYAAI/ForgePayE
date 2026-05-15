"""
US Sales Tax Filing via Avalara and direct state API stubs.

ForgePay calculates US sales tax at checkout via TaxJar/Avalara.
This module generates filing reports and triggers remittance.
"""
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# US states that require sales tax (all 45 + DC)
US_SALES_TAX_STATES = {
    "AL": {"name": "Alabama", "has_local_tax": True, "filing_frequency": "monthly"},
    "AK": {"name": "Alaska", "has_local_tax": True, "filing_frequency": "quarterly"},
    "AZ": {"name": "Arizona", "has_local_tax": True, "filing_frequency": "monthly"},
    "AR": {"name": "Arkansas", "has_local_tax": True, "filing_frequency": "monthly"},
    "CA": {"name": "California", "has_local_tax": True, "filing_frequency": "monthly"},
    "CO": {"name": "Colorado", "has_local_tax": True, "filing_frequency": "monthly"},
    "CT": {"name": "Connecticut", "has_local_tax": False, "filing_frequency": "monthly"},
    "DC": {"name": "District of Columbia", "has_local_tax": False, "filing_frequency": "monthly"},
    "FL": {"name": "Florida", "has_local_tax": True, "filing_frequency": "monthly"},
    "GA": {"name": "Georgia", "has_local_tax": True, "filing_frequency": "monthly"},
    "HI": {"name": "Hawaii", "has_local_tax": True, "filing_frequency": "monthly"},
    "ID": {"name": "Idaho", "has_local_tax": False, "filing_frequency": "monthly"},
    "IL": {"name": "Illinois", "has_local_tax": True, "filing_frequency": "monthly"},
    "IN": {"name": "Indiana", "has_local_tax": False, "filing_frequency": "monthly"},
    "IA": {"name": "Iowa", "has_local_tax": True, "filing_frequency": "monthly"},
    "KS": {"name": "Kansas", "has_local_tax": True, "filing_frequency": "monthly"},
    "KY": {"name": "Kentucky", "has_local_tax": False, "filing_frequency": "monthly"},
    "LA": {"name": "Louisiana", "has_local_tax": True, "filing_frequency": "monthly"},
    "ME": {"name": "Maine", "has_local_tax": False, "filing_frequency": "monthly"},
    "MD": {"name": "Maryland", "has_local_tax": False, "filing_frequency": "monthly"},
    "MA": {"name": "Massachusetts", "has_local_tax": False, "filing_frequency": "monthly"},
    "MI": {"name": "Michigan", "has_local_tax": False, "filing_frequency": "monthly"},
    "MN": {"name": "Minnesota", "has_local_tax": True, "filing_frequency": "monthly"},
    "MS": {"name": "Mississippi", "has_local_tax": False, "filing_frequency": "monthly"},
    "MO": {"name": "Missouri", "has_local_tax": True, "filing_frequency": "monthly"},
    "NE": {"name": "Nebraska", "has_local_tax": True, "filing_frequency": "monthly"},
    "NV": {"name": "Nevada", "has_local_tax": True, "filing_frequency": "monthly"},
    "NJ": {"name": "New Jersey", "has_local_tax": False, "filing_frequency": "monthly"},
    "NM": {"name": "New Mexico", "has_local_tax": True, "filing_frequency": "monthly"},
    "NY": {"name": "New York", "has_local_tax": True, "filing_frequency": "monthly"},
    "NC": {"name": "North Carolina", "has_local_tax": True, "filing_frequency": "monthly"},
    "ND": {"name": "North Dakota", "has_local_tax": True, "filing_frequency": "monthly"},
    "OH": {"name": "Ohio", "has_local_tax": True, "filing_frequency": "monthly"},
    "OK": {"name": "Oklahoma", "has_local_tax": True, "filing_frequency": "monthly"},
    "PA": {"name": "Pennsylvania", "has_local_tax": False, "filing_frequency": "monthly"},
    "RI": {"name": "Rhode Island", "has_local_tax": False, "filing_frequency": "monthly"},
    "SC": {"name": "South Carolina", "has_local_tax": True, "filing_frequency": "monthly"},
    "SD": {"name": "South Dakota", "has_local_tax": True, "filing_frequency": "monthly"},
    "TN": {"name": "Tennessee", "has_local_tax": True, "filing_frequency": "monthly"},
    "TX": {"name": "Texas", "has_local_tax": True, "filing_frequency": "monthly"},
    "UT": {"name": "Utah", "has_local_tax": True, "filing_frequency": "monthly"},
    "VT": {"name": "Vermont", "has_local_tax": False, "filing_frequency": "monthly"},
    "VA": {"name": "Virginia", "has_local_tax": True, "filing_frequency": "monthly"},
    "WA": {"name": "Washington", "has_local_tax": True, "filing_frequency": "monthly"},
    "WV": {"name": "West Virginia", "has_local_tax": True, "filing_frequency": "monthly"},
    "WI": {"name": "Wisconsin", "has_local_tax": True, "filing_frequency": "monthly"},
    "WY": {"name": "Wyoming", "has_local_tax": True, "filing_frequency": "monthly"},
}


@dataclass
class USSalesTaxLine:
    state: str
    state_name: str
    period: str
    gross_sales: float
    exempt_sales: float
    taxable_sales: float
    state_tax: float
    local_tax: float
    total_tax: float
    transaction_count: int
    filing_due_date: date
    status: str = "pending"
    filing_reference: Optional[str] = None


@dataclass
class USSalesTaxReturn:
    merchant_id: str
    period: str
    period_start: date
    period_end: date
    lines: list[USSalesTaxLine] = field(default_factory=list)
    total_tax_due: float = 0.0
    status: str = "draft"
    created_at: datetime = field(default_factory=datetime.now)


def generate_us_return(
    merchant_id: str,
    transactions: list[dict],  # Each: {state, amount, tax_amount, is_exempt}
    period: str,
    period_start: date,
    period_end: date,
) -> USSalesTaxReturn:
    """Generate a US sales tax return from transaction data."""
    by_state: dict[str, dict] = {}

    for txn in transactions:
        state = txn.get("state", "")
        if not state or state not in US_SALES_TAX_STATES:
            continue
        if state not in by_state:
            by_state[state] = {
                "gross": 0,
                "exempt": 0,
                "taxable": 0,
                "state_tax": 0,
                "local_tax": 0,
                "count": 0,
            }

        amount = txn.get("amount", 0)
        tax = txn.get("tax_amount", 0)
        is_exempt = txn.get("is_exempt", False)

        by_state[state]["gross"] += amount
        by_state[state]["count"] += 1
        if is_exempt:
            by_state[state]["exempt"] += amount
        else:
            by_state[state]["taxable"] += amount
            # Rough split: 70% state, 30% local (simplified)
            by_state[state]["state_tax"] += tax * 0.70
            by_state[state]["local_tax"] += tax * 0.30

    lines = []
    total_tax = 0.0

    for state_code, data in by_state.items():
        total_state_tax = data["state_tax"] + data["local_tax"]
        total_tax += total_state_tax

        # Filing due: 20th of month following period
        from dateutil.relativedelta import relativedelta
        due_date = period_end.replace(day=1) + relativedelta(months=1, days=19)

        lines.append(USSalesTaxLine(
            state=state_code,
            state_name=US_SALES_TAX_STATES[state_code]["name"],
            period=period,
            gross_sales=round(data["gross"], 2),
            exempt_sales=round(data["exempt"], 2),
            taxable_sales=round(data["taxable"], 2),
            state_tax=round(data["state_tax"], 2),
            local_tax=round(data["local_tax"], 2),
            total_tax=round(total_state_tax, 2),
            transaction_count=data["count"],
            filing_due_date=due_date,
        ))

    return USSalesTaxReturn(
        merchant_id=merchant_id,
        period=period,
        period_start=period_start,
        period_end=period_end,
        lines=sorted(lines, key=lambda l: l.total_tax, reverse=True),
        total_tax_due=round(total_tax, 2),
        status="draft",
    )


def file_via_avalara_stub(merchant_id: str, tax_return: USSalesTaxReturn) -> dict:
    """
    Stub for filing US sales tax via Avalara Managed Returns.

    Production: POST to Avalara API with merchant's Avalara account credentials.
    Avalara handles filing to each state automatically.
    """
    logger.info(
        f"[AVALARA STUB] Would file US sales tax for merchant {merchant_id}, "
        f"period {tax_return.period}, total tax ${tax_return.total_tax_due:.2f}, "
        f"states: {[l.state for l in tax_return.lines]}"
    )

    return {
        "status": "submitted_to_avalara",
        "avalara_batch_id": f"AVA-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "states_count": len(tax_return.lines),
        "total_tax": tax_return.total_tax_due,
        "period": tax_return.period,
        "estimated_filing_completion": "within 3 business days",
        "note": "Production filing requires Avalara account with Managed Returns enabled",
    }
