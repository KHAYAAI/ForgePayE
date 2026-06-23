"""
Tax Remittance Orchestrator.

After calculating tax liability, this module generates payment instructions
to remit taxes to the appropriate authorities.
"""
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Optional
import logging

import httpx

logger = logging.getLogger(__name__)


@dataclass
class RemittanceInstruction:
    id: str
    merchant_id: str
    tax_type: str           # "eu_vat" | "us_sales_tax" | "uk_vat" | "income_tax"
    jurisdiction: str       # "DE" | "CA" | "GB"
    period: str
    amount: float
    currency: str           # "EUR" | "USD" | "GBP"
    due_date: date
    recipient_name: str     # Tax authority name
    recipient_account: str  # Bank account or sort code
    recipient_routing: str  # Swift/BIC or ABA routing
    reference: str          # Payment reference (tax authority's reference)
    status: str = "pending"  # "pending" | "initiated" | "completed" | "failed"
    initiated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    payment_confirmation: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class RemittanceResult:
    status: str                         # "initiated" | "failed"
    transfer_id: Optional[str] = None
    initiated_at: Optional[datetime] = None
    error: Optional[str] = None


# Tax authority banking details (simplified; production: use verified API)
TAX_AUTHORITY_ACCOUNTS = {
    "DE_VAT": {
        "recipient_name": "Bundeszentralamt fuer Steuern",
        "recipient_account": "DE89370400440532013000",  # Example IBAN
        "recipient_routing": "COBADEFFXXX",
        "currency": "EUR",
    },
    "FR_VAT": {
        "recipient_name": "Direction Generale des Finances Publiques",
        "recipient_account": "FR7630004000031234567890143",
        "recipient_routing": "BNPAFRPPXXX",
        "currency": "EUR",
    },
    "GB_VAT": {
        "recipient_name": "HMRC VAT",
        "recipient_account": "GB71BARC20114700000292",
        "recipient_routing": "20-11-47",
        "currency": "GBP",
    },
    "US_IRS": {
        "recipient_name": "Internal Revenue Service",
        "recipient_account": "EFTPS",  # Electronic Federal Tax Payment System
        "recipient_routing": "EFTPS",
        "currency": "USD",
    },
}


def generate_eu_vat_remittance(
    merchant_id: str,
    jurisdiction: str,
    amount: float,
    period: str,
    due_date: date,
    merchant_vat_number: str,
) -> RemittanceInstruction:
    """Generate a remittance instruction for EU VAT payment."""
    import uuid

    authority_key = f"{jurisdiction}_VAT"
    authority = TAX_AUTHORITY_ACCOUNTS.get(authority_key, {
        "recipient_name": f"Tax Authority ({jurisdiction})",
        "recipient_account": f"TBD-{jurisdiction}",
        "recipient_routing": "TBD",
        "currency": "EUR",
    })

    return RemittanceInstruction(
        id=str(uuid.uuid4()),
        merchant_id=merchant_id,
        tax_type="eu_vat",
        jurisdiction=jurisdiction,
        period=period,
        amount=round(amount, 2),
        currency=authority["currency"],
        due_date=due_date,
        recipient_name=authority["recipient_name"],
        recipient_account=authority["recipient_account"],
        recipient_routing=authority["recipient_routing"],
        reference=f"VAT/{merchant_vat_number}/{period}",
    )


def generate_us_sales_tax_remittances(
    merchant_id: str,
    state_amounts: list[dict],  # [{state, amount, period, due_date}]
) -> list[RemittanceInstruction]:
    """Generate remittance instructions for US state sales tax."""
    import uuid

    instructions = []
    for item in state_amounts:
        state = item["state"]
        instructions.append(RemittanceInstruction(
            id=str(uuid.uuid4()),
            merchant_id=merchant_id,
            tax_type="us_sales_tax",
            jurisdiction=state,
            period=item["period"],
            amount=round(item["amount"], 2),
            currency="USD",
            due_date=item["due_date"],
            recipient_name=f"{state} Department of Revenue",
            recipient_account=f"EFT-{state}",  # In production: state's EFT details
            recipient_routing=f"STATE-{state}",
            reference=f"SALES-TAX/{merchant_id}/{item['period']}/{state}",
        ))
    return instructions


async def initiate_remittance(
    instruction: RemittanceInstruction,
    bank_connectivity_url: str,
    internal_secret: str,
) -> RemittanceResult:
    """
    Initiate a tax remittance payment via the bank-connectivity service.

    POSTs to {bank_connectivity_url}/api/v1/transfers/internal with HMAC-level
    internal auth headers. On success returns a RemittanceResult with the
    transfer_id assigned by bank-connectivity; on any error returns status='failed'.
    """
    payload = {
        "from_account": "MOR_OPERATING",
        "to_iban": instruction.recipient_account,
        "to_routing": instruction.recipient_routing,
        "amount_cents": round(instruction.amount * 100),
        "currency": instruction.currency,
        "reference": instruction.reference,
        "description": f"Tax remittance: {instruction.recipient_name}",
    }
    headers = {
        "x-source": "mor-layer",
        "x-internal-secret": internal_secret,
        "Content-Type": "application/json",
    }

    logger.info(
        "Initiating remittance to bank-connectivity: %s %s %.2f for %s period %s",
        instruction.currency,
        instruction.amount,
        instruction.amount,
        instruction.jurisdiction,
        instruction.period,
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{bank_connectivity_url}/api/v1/transfers/internal",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            transfer_id = data.get("transferId") or data.get("transfer_id")
            logger.info(
                "Remittance initiated: transfer_id=%s instruction_id=%s",
                transfer_id,
                instruction.id,
            )
            return RemittanceResult(
                status="initiated",
                transfer_id=transfer_id,
                initiated_at=datetime.utcnow(),
            )
    except httpx.HTTPStatusError as exc:
        error_msg = (
            f"bank-connectivity returned {exc.response.status_code}: {exc.response.text}"
        )
        logger.error("Remittance failed: %s (instruction_id=%s)", error_msg, instruction.id)
        return RemittanceResult(status="failed", error=error_msg)
    except Exception as exc:
        error_msg = str(exc)
        logger.error(
            "Remittance error: %s (instruction_id=%s)", error_msg, instruction.id,
            exc_info=True,
        )
        return RemittanceResult(status="failed", error=error_msg)


async def schedule_periodic_remittance(
    bank_connectivity_url: str,
    internal_secret: str,
    merchant_id: str,
    merchant_vat_number: str,
) -> list[RemittanceResult]:
    """
    Trigger monthly EU VAT remittances.

    Intended to be called on the 15th of each month (e.g. via a Kubernetes
    CronJob or APScheduler). Generates EU VAT remittance instructions for the
    previous calendar month and initiates each via bank-connectivity.

    Returns a list of RemittanceResult objects, one per jurisdiction.
    """
    from calendar import monthrange
    from datetime import timedelta

    now = datetime.utcnow()
    # Compute previous month
    first_of_current = now.replace(day=1)
    last_of_prev = first_of_current - timedelta(days=1)
    prev_year = last_of_prev.year
    prev_month = last_of_prev.month
    period = f"{prev_year}-{prev_month:02d}"
    period_start = date(prev_year, prev_month, 1)
    period_end = date(prev_year, prev_month, monthrange(prev_year, prev_month)[1])
    due_date = period_end.replace(day=28)  # Simplified: use 28th of following month

    logger.info(
        "schedule_periodic_remittance: generating EU VAT remittance for period %s", period
    )

    # EU jurisdictions with active VAT liability (production: query DB for actuals)
    eu_jurisdictions = list(generate_eu_vat_remittance.__module__ and {
        "DE": 0.0, "FR": 0.0, "NL": 0.0,
    }.keys())

    results: list[RemittanceResult] = []
    for jurisdiction in eu_jurisdictions:
        instruction = generate_eu_vat_remittance(
            merchant_id=merchant_id,
            jurisdiction=jurisdiction,
            amount=0.0,  # Production: query actual liability from DB
            period=period,
            due_date=due_date,
            merchant_vat_number=merchant_vat_number,
        )

        if instruction.amount <= 0:
            logger.info(
                "Skipping zero-amount remittance for %s period %s", jurisdiction, period
            )
            results.append(RemittanceResult(status="skipped"))
            continue

        result = await initiate_remittance(
            instruction=instruction,
            bank_connectivity_url=bank_connectivity_url,
            internal_secret=internal_secret,
        )
        logger.info(
            "Periodic remittance %s for %s/%s: transfer_id=%s error=%s",
            result.status,
            jurisdiction,
            period,
            result.transfer_id,
            result.error,
        )
        results.append(result)

    return results
