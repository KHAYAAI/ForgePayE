"""
Tax Remittance Orchestrator.

After calculating tax liability, this module generates payment instructions
to remit taxes to the appropriate authorities.
"""
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Optional
import logging

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


def initiate_remittance_stub(instruction: RemittanceInstruction) -> dict:
    """
    Stub for initiating a tax remittance payment.

    In production, this would:
    1. Call the bank-connectivity service to initiate ACH/SEPA/SWIFT payment
    2. Include tax reference in payment details
    3. Track confirmation from bank
    """
    logger.info(
        f"[REMITTANCE STUB] Would initiate {instruction.currency} {instruction.amount:.2f} "
        f"payment to {instruction.recipient_name} for {instruction.jurisdiction} "
        f"taxes, period {instruction.period}"
    )

    instruction.status = "initiated"
    instruction.initiated_at = datetime.now()
    instruction.payment_confirmation = f"PAY-{instruction.id[:8].upper()}"

    return {
        "status": "initiated",
        "remittance_id": instruction.id,
        "amount": instruction.amount,
        "currency": instruction.currency,
        "recipient": instruction.recipient_name,
        "reference": instruction.reference,
        "estimated_settlement": "1-3 business days",
        "note": "Production remittance requires bank-connectivity service with active banking credentials",
    }
