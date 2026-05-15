"""
EU VAT Return Generator and Filer.

Generates VAT return data for each EU country based on ForgePay transaction data.
Filing is done via country-specific APIs (stubbed) or via Avalara's EU VAT service.
"""
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# EU VAT rates per country (standard rate, reduced rate)
EU_VAT_RATES = {
    "AT": {"standard": 0.20, "reduced": 0.10, "name": "Austria"},
    "BE": {"standard": 0.21, "reduced": 0.06, "name": "Belgium"},
    "BG": {"standard": 0.20, "reduced": 0.09, "name": "Bulgaria"},
    "CY": {"standard": 0.19, "reduced": 0.05, "name": "Cyprus"},
    "CZ": {"standard": 0.21, "reduced": 0.10, "name": "Czech Republic"},
    "DE": {"standard": 0.19, "reduced": 0.07, "name": "Germany"},
    "DK": {"standard": 0.25, "reduced": None, "name": "Denmark"},
    "EE": {"standard": 0.20, "reduced": 0.09, "name": "Estonia"},
    "ES": {"standard": 0.21, "reduced": 0.10, "name": "Spain"},
    "FI": {"standard": 0.24, "reduced": 0.10, "name": "Finland"},
    "FR": {"standard": 0.20, "reduced": 0.055, "name": "France"},
    "GR": {"standard": 0.24, "reduced": 0.13, "name": "Greece"},
    "HR": {"standard": 0.25, "reduced": 0.05, "name": "Croatia"},
    "HU": {"standard": 0.27, "reduced": 0.05, "name": "Hungary"},
    "IE": {"standard": 0.23, "reduced": 0.09, "name": "Ireland"},
    "IT": {"standard": 0.22, "reduced": 0.05, "name": "Italy"},
    "LT": {"standard": 0.21, "reduced": 0.09, "name": "Lithuania"},
    "LU": {"standard": 0.17, "reduced": 0.03, "name": "Luxembourg"},
    "LV": {"standard": 0.21, "reduced": 0.12, "name": "Latvia"},
    "MT": {"standard": 0.18, "reduced": 0.05, "name": "Malta"},
    "NL": {"standard": 0.21, "reduced": 0.09, "name": "Netherlands"},
    "PL": {"standard": 0.23, "reduced": 0.05, "name": "Poland"},
    "PT": {"standard": 0.23, "reduced": 0.06, "name": "Portugal"},
    "RO": {"standard": 0.19, "reduced": 0.05, "name": "Romania"},
    "SE": {"standard": 0.25, "reduced": 0.06, "name": "Sweden"},
    "SI": {"standard": 0.22, "reduced": 0.095, "name": "Slovenia"},
    "SK": {"standard": 0.20, "reduced": 0.10, "name": "Slovakia"},
    "GB": {"standard": 0.20, "reduced": 0.05, "name": "United Kingdom"},  # Post-Brexit, still needed
}


@dataclass
class VATTransaction:
    transaction_id: str
    date: date
    customer_country: str
    product_type: str  # "digital_service" | "physical_good" | "b2b_service"
    amount_net: float  # before VAT
    vat_amount: float
    vat_rate: float
    currency: str = "EUR"


@dataclass
class VATReturnLine:
    country_code: str
    country_name: str
    period: str  # "2026-Q1" or "2026-05"
    net_sales: float
    vat_collected: float
    vat_rate: float
    transaction_count: int
    filing_due_date: date
    status: str = "pending"  # "pending" | "filed" | "confirmed"
    confirmation_number: Optional[str] = None


@dataclass
class VATReturn:
    merchant_id: str
    merchant_vat_number: str
    period: str
    period_start: date
    period_end: date
    lines: list[VATReturnLine] = field(default_factory=list)
    total_vat_due: float = 0.0
    filing_due_date: Optional[date] = None
    filed_at: Optional[datetime] = None
    status: str = "draft"  # "draft" | "ready" | "filed" | "confirmed"
    created_at: datetime = field(default_factory=datetime.now)


def generate_vat_return(
    merchant_id: str,
    merchant_vat_number: str,
    transactions: list[VATTransaction],
    period: str,
    period_start: date,
    period_end: date,
) -> VATReturn:
    """Generate a VAT return from transaction data."""
    # Group transactions by country
    by_country: dict[str, list[VATTransaction]] = {}
    for txn in transactions:
        cc = txn.customer_country
        if cc not in by_country:
            by_country[cc] = []
        by_country[cc].append(txn)

    lines: list[VATReturnLine] = []
    total_vat = 0.0

    for country_code, country_txns in by_country.items():
        if country_code not in EU_VAT_RATES:
            continue  # Not an EU country

        country_info = EU_VAT_RATES[country_code]
        net_sales = sum(t.amount_net for t in country_txns)
        vat_collected = sum(t.vat_amount for t in country_txns)
        avg_rate = vat_collected / net_sales if net_sales > 0 else country_info["standard"]

        # Filing due date: last day of month following end of quarter
        # (simplified; in practice each country has different rules)
        due_date = _calculate_filing_due_date(period_end, country_code)

        line = VATReturnLine(
            country_code=country_code,
            country_name=country_info["name"],
            period=period,
            net_sales=round(net_sales, 2),
            vat_collected=round(vat_collected, 2),
            vat_rate=round(avg_rate, 4),
            transaction_count=len(country_txns),
            filing_due_date=due_date,
        )
        lines.append(line)
        total_vat += vat_collected

    return VATReturn(
        merchant_id=merchant_id,
        merchant_vat_number=merchant_vat_number,
        period=period,
        period_start=period_start,
        period_end=period_end,
        lines=sorted(lines, key=lambda l: l.vat_collected, reverse=True),
        total_vat_due=round(total_vat, 2),
        filing_due_date=_calculate_filing_due_date(period_end, "EU"),
    )


def _calculate_filing_due_date(period_end: date, country_code: str) -> date:
    """Calculate the VAT filing due date for a given period end and country."""
    # EU MOSS: file within 20 days of quarter end
    # Individual countries: typically 1 month after period end
    from dateutil.relativedelta import relativedelta
    return period_end + relativedelta(months=1)


def file_vat_return_stub(vat_return: VATReturn, country_code: str) -> dict:
    """
    Stub for filing a VAT return to a tax authority.

    In production, this would call country-specific APIs:
    - DE: FinanzOnline API
    - FR: DGFiP API
    - ES: Sede Electronica
    - etc.

    For cross-border digital services, use EU OSS (One Stop Shop) portal.
    """
    logger.info(
        f"[VAT FILING STUB] Would file VAT return for merchant {vat_return.merchant_id}, "
        f"country {country_code}, amount €{vat_return.total_vat_due:.2f}"
    )

    # Simulate successful filing
    return {
        "status": "filed",
        "confirmation_number": f"VAT-{country_code}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "filed_at": datetime.now().isoformat(),
        "country": country_code,
        "amount": vat_return.total_vat_due,
        "note": "This is a stub - production filing requires country-specific API credentials",
    }


def file_eu_oss_return(vat_return: VATReturn) -> dict:
    """
    File the EU One Stop Shop (OSS) return for cross-border digital services.
    This is the simplified way to file for B2C digital services across all EU countries.

    Production: POST to EU OSS portal API with merchant's OSS registration number.
    """
    logger.info(
        f"[EU OSS STUB] Would file OSS return for {vat_return.period}, "
        f"total VAT due: €{vat_return.total_vat_due:.2f}, "
        f"countries: {[l.country_code for l in vat_return.lines]}"
    )

    return {
        "status": "submitted",
        "reference_number": f"OSS-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "total_vat_due": vat_return.total_vat_due,
        "period": vat_return.period,
        "countries": len(vat_return.lines),
        "note": "Production filing requires EU OSS portal registration and API credentials",
    }
