"""Tax engine tests for MoR Layer."""

import pytest
from decimal import Decimal


# Mock tax engine
class TaxEngine:
    """Calculate tax for any jurisdiction in the world."""

    TAX_RATES = {
        'US': {
            'default': Decimal('0.00'),
            'states': {
                'CA': Decimal('0.0725'),
                'NY': Decimal('0.04'),
                'TX': Decimal('0.0625'),
            }
        },
        'EU': {
            'default': Decimal('0.19'),  # Germany
            'countries': {
                'FR': Decimal('0.20'),
                'IT': Decimal('0.22'),
                'ES': Decimal('0.21'),
            }
        },
        'GB': Decimal('0.20'),
        'CA': Decimal('0.13'),
        'AU': Decimal('0.10'),
    }

    def calculate_tax(
        self,
        amount: Decimal,
        jurisdiction: str,
        item_type: str = 'digital_goods',
    ) -> Decimal:
        """Calculate tax for given amount and jurisdiction."""
        # Get tax rate
        if jurisdiction.startswith('US_'):
            state = jurisdiction.split('_')[1]
            rate = self.TAX_RATES['US']['states'].get(
                state,
                self.TAX_RATES['US']['default']
            )
        elif jurisdiction.startswith('EU_'):
            country = jurisdiction.split('_')[1]
            rate = self.TAX_RATES['EU']['countries'].get(
                country,
                self.TAX_RATES['EU']['default']
            )
        else:
            rate = self.TAX_RATES.get(jurisdiction, Decimal('0.00'))

        # Digital goods exempt in some regions (simplified)
        if item_type == 'digital_goods' and jurisdiction in ['US']:
            return Decimal('0')

        tax = amount * rate
        return tax.quantize(Decimal('0.01'))


@pytest.fixture
def tax_engine():
    return TaxEngine()


class TestTaxCalculation:
    """Test tax rate calculation for various jurisdictions."""

    def test_calculate_us_sales_tax(self, tax_engine):
        """Test US state sales tax calculation."""
        amount = Decimal('100.00')

        # California
        tax = tax_engine.calculate_tax(amount, 'US_CA')
        assert tax == Decimal('7.25')

        # New York
        tax = tax_engine.calculate_tax(amount, 'US_NY')
        assert tax == Decimal('4.00')

        # Texas
        tax = tax_engine.calculate_tax(amount, 'US_TX')
        assert tax == Decimal('6.25')

    def test_calculate_eu_vat(self, tax_engine):
        """Test European VAT calculation."""
        amount = Decimal('100.00')

        # Germany default
        tax = tax_engine.calculate_tax(amount, 'EU_DE')
        assert tax == Decimal('19.00')

        # France
        tax = tax_engine.calculate_tax(amount, 'EU_FR')
        assert tax == Decimal('20.00')

        # Italy
        tax = tax_engine.calculate_tax(amount, 'EU_IT')
        assert tax == Decimal('22.00')

    def test_calculate_uk_vat(self, tax_engine):
        """Test UK VAT calculation."""
        amount = Decimal('100.00')
        tax = tax_engine.calculate_tax(amount, 'GB')
        assert tax == Decimal('20.00')

    def test_calculate_au_gst(self, tax_engine):
        """Test Australian GST calculation."""
        amount = Decimal('100.00')
        tax = tax_engine.calculate_tax(amount, 'AU')
        assert tax == Decimal('10.00')

    def test_digital_goods_exemption(self, tax_engine):
        """Test digital goods exemption where applicable."""
        amount = Decimal('100.00')
        tax = tax_engine.calculate_tax(
            amount, 'US_CA', item_type='digital_goods'
        )
        # US digital goods are exempt
        assert tax == Decimal('0.00')

    def test_rounding(self, tax_engine):
        """Test proper rounding to cents."""
        amount = Decimal('33.33')
        tax = tax_engine.calculate_tax(amount, 'US_CA')
        # 33.33 * 0.0725 = 2.416425 -> 2.42
        assert tax == Decimal('2.42')

    def test_zero_tax_jurisdiction(self, tax_engine):
        """Test jurisdiction with no tax."""
        amount = Decimal('100.00')
        tax = tax_engine.calculate_tax(amount, 'UNKNOWN')
        assert tax == Decimal('0.00')


class TestTaxCompliance:
    """Test tax compliance and audit trail."""

    def test_tax_calculation_consistency(self, tax_engine):
        """Test that tax calculation is consistent."""
        amount = Decimal('100.00')
        tax1 = tax_engine.calculate_tax(amount, 'US_CA')
        tax2 = tax_engine.calculate_tax(amount, 'US_CA')
        assert tax1 == tax2

    def test_tax_is_non_negative(self, tax_engine):
        """Test that tax amount is never negative."""
        for amount in [Decimal('1.00'), Decimal('100.00'), Decimal('10000.00')]:
            for jurisdiction in ['US_CA', 'EU_FR', 'GB', 'AU']:
                tax = tax_engine.calculate_tax(amount, jurisdiction)
                assert tax >= Decimal('0.00')
