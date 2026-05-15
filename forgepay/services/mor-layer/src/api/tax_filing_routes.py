"""
Tax Filing API routes for the MoR Layer.

These routes expose tax filing, remittance, and audit export capabilities.
"""
import json
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..tax_filing.audit_exporter import (
    generate_csv_report,
    generate_json_report,
    generate_summary_report,
)
from ..tax_filing.eu_vat_filer import (
    VATTransaction,
    file_eu_oss_return,
    file_vat_return_stub,
    generate_vat_return,
)
from ..tax_filing.remittance_orchestrator import (
    generate_eu_vat_remittance,
    generate_us_sales_tax_remittances,
    initiate_remittance_stub,
)
from ..tax_filing.us_sales_tax_filer import file_via_avalara_stub, generate_us_return

router = APIRouter(prefix="/v1/tax-filing", tags=["tax-filing"])
logger = logging.getLogger(__name__)


class EUVATReturnRequest(BaseModel):
    merchant_id: str
    merchant_vat_number: str
    period: str                    # e.g. "2026-Q1"
    period_start: date
    period_end: date
    transactions: list[dict]       # VATTransaction-like dicts
    auto_file: bool = False        # If True, file immediately (stub)


class USSalesTaxReturnRequest(BaseModel):
    merchant_id: str
    period: str
    period_start: date
    period_end: date
    transactions: list[dict]
    auto_file_via_avalara: bool = False


class AuditReportRequest(BaseModel):
    merchant_id: str
    period: str
    period_start: date
    period_end: date
    transactions: list[dict]
    format: str = "summary"        # "summary" | "csv" | "json"


class RemittanceRequest(BaseModel):
    merchant_id: str
    jurisdiction: str
    tax_type: str                  # "eu_vat" | "us_sales_tax"
    amount: float
    currency: str = "USD"
    period: str
    due_date: date
    merchant_vat_number: Optional[str] = None


@router.post("/eu-vat/generate")
async def generate_eu_vat_return(request: EUVATReturnRequest):
    """Generate an EU VAT return from transaction data."""
    txns = [
        VATTransaction(
            transaction_id=t.get("id", ""),
            date=date.fromisoformat(t.get("date", date.today().isoformat())),
            customer_country=t.get("jurisdiction", "DE"),
            product_type=t.get("product_type", "digital_service"),
            amount_net=t.get("amount", 0),
            vat_amount=t.get("tax_amount", 0),
            vat_rate=t.get("tax_rate", 0),
            currency=t.get("currency", "EUR"),
        )
        for t in request.transactions
    ]

    vat_return = generate_vat_return(
        merchant_id=request.merchant_id,
        merchant_vat_number=request.merchant_vat_number,
        transactions=txns,
        period=request.period,
        period_start=request.period_start,
        period_end=request.period_end,
    )

    result = {
        "merchant_id": vat_return.merchant_id,
        "period": vat_return.period,
        "total_vat_due": vat_return.total_vat_due,
        "status": vat_return.status,
        "lines": [
            {
                "country": line.country_code,
                "country_name": line.country_name,
                "net_sales": line.net_sales,
                "vat_collected": line.vat_collected,
                "transaction_count": line.transaction_count,
                "filing_due_date": line.filing_due_date.isoformat(),
            }
            for line in vat_return.lines
        ],
        "filing_due_date": (
            vat_return.filing_due_date.isoformat() if vat_return.filing_due_date else None
        ),
    }

    if request.auto_file:
        filing_result = file_eu_oss_return(vat_return)
        result["filing_result"] = filing_result

    return result


@router.post("/eu-vat/file")
async def file_eu_vat(request: EUVATReturnRequest):
    """Generate and immediately file EU VAT return via OSS (stub)."""
    request.auto_file = True
    return await generate_eu_vat_return(request)


@router.post("/us-sales-tax/generate")
async def generate_us_sales_tax(request: USSalesTaxReturnRequest):
    """Generate US sales tax return from transaction data."""
    tax_return = generate_us_return(
        merchant_id=request.merchant_id,
        transactions=request.transactions,
        period=request.period,
        period_start=request.period_start,
        period_end=request.period_end,
    )

    result = {
        "merchant_id": tax_return.merchant_id,
        "period": tax_return.period,
        "total_tax_due": tax_return.total_tax_due,
        "status": tax_return.status,
        "state_count": len(tax_return.lines),
        "lines": [
            {
                "state": line.state,
                "state_name": line.state_name,
                "gross_sales": line.gross_sales,
                "taxable_sales": line.taxable_sales,
                "total_tax": line.total_tax,
                "transaction_count": line.transaction_count,
                "filing_due_date": line.filing_due_date.isoformat(),
            }
            for line in tax_return.lines
        ],
    }

    if request.auto_file_via_avalara:
        filing_result = file_via_avalara_stub(request.merchant_id, tax_return)
        result["avalara_result"] = filing_result

    return result


@router.post("/remittance/initiate")
async def initiate_remittance(request: RemittanceRequest):
    """Initiate a tax remittance payment to the tax authority (stub)."""
    if request.tax_type == "eu_vat":
        instruction = generate_eu_vat_remittance(
            merchant_id=request.merchant_id,
            jurisdiction=request.jurisdiction,
            amount=request.amount,
            period=request.period,
            due_date=request.due_date,
            merchant_vat_number=request.merchant_vat_number or f"VAT-{request.merchant_id}",
        )
    else:
        instructions = generate_us_sales_tax_remittances(
            merchant_id=request.merchant_id,
            state_amounts=[{
                "state": request.jurisdiction,
                "amount": request.amount,
                "period": request.period,
                "due_date": request.due_date,
            }],
        )
        instruction = instructions[0] if instructions else None

    if not instruction:
        raise HTTPException(status_code=400, detail="Could not generate remittance instruction")

    result = initiate_remittance_stub(instruction)
    return {
        "remittance_id": instruction.id,
        "merchant_id": request.merchant_id,
        "jurisdiction": request.jurisdiction,
        "amount": instruction.amount,
        "currency": instruction.currency,
        "recipient": instruction.recipient_name,
        "reference": instruction.reference,
        "status": instruction.status,
        "result": result,
    }


@router.post("/audit/export")
async def export_audit_report(request: AuditReportRequest):
    """Generate a tax compliance audit report."""
    kwargs = dict(
        merchant_id=request.merchant_id,
        period=request.period,
        period_start=request.period_start,
        period_end=request.period_end,
        transactions=request.transactions,
    )

    if request.format == "csv":
        report = generate_csv_report(**kwargs)
        return {
            "format": "csv",
            "content": report.content,
            "summary": {
                "total_tax": report.total_tax_collected,
                "transactions": report.transaction_count,
            },
        }
    elif request.format == "json":
        report = generate_json_report(**kwargs)
        return {
            "format": "json",
            "data": json.loads(report.content),
            "summary": {"total_tax": report.total_tax_collected},
        }
    else:
        report = generate_summary_report(**kwargs)
        return {
            "format": "summary",
            "content": report.content,
            "summary": {
                "total_tax": report.total_tax_collected,
                "total_revenue": report.total_revenue,
            },
        }


@router.get("/status/{merchant_id}")
async def get_filing_status(merchant_id: str, period: str = Query(default="current")):
    """Get the current tax filing status for a merchant."""
    # In production: query from PostgreSQL
    return {
        "merchant_id": merchant_id,
        "period": period,
        "eu_vat": {"status": "pending", "amount_due": 0, "filed": False},
        "us_sales_tax": {"status": "pending", "amount_due": 0, "states": []},
        "last_filing": None,
        "next_due_date": None,
        "filing_service": "ForgePay Automated Tax Filing",
        "tier_required": "standard",
    }
