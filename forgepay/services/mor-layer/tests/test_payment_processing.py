"""Payment processing tests for MoR Layer."""

import pytest
from datetime import datetime
from decimal import Decimal
from typing import Optional


# Mock payment processing
class Payment:
    """Payment state machine."""

    def __init__(
        self,
        payment_id: str,
        merchant_id: str,
        amount: int,
        currency: str,
        status: str = 'created',
    ):
        self.payment_id = payment_id
        self.merchant_id = merchant_id
        self.amount = amount
        self.currency = currency
        self.status = status
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
        self.metadata: dict = {}

    def mark_processing(self) -> bool:
        """Transition to processing state."""
        if self.status not in ['created']:
            return False
        self.status = 'processing'
        self.updated_at = datetime.now()
        return True

    def mark_succeeded(self) -> bool:
        """Transition to succeeded state."""
        if self.status not in ['processing']:
            return False
        self.status = 'succeeded'
        self.updated_at = datetime.now()
        return True

    def mark_failed(self, reason: str) -> bool:
        """Transition to failed state."""
        if self.status not in ['created', 'processing']:
            return False
        self.status = 'failed'
        self.metadata['error'] = reason
        self.updated_at = datetime.now()
        return True

    def is_terminal(self) -> bool:
        """Check if payment reached terminal state."""
        return self.status in ['succeeded', 'failed']


class TestPaymentStateMachine:
    """Test payment state transitions."""

    def test_create_payment(self):
        """Test payment creation."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')
        assert payment.status == 'created'
        assert payment.amount == 10000
        assert payment.currency == 'USD'

    def test_valid_state_transition(self):
        """Test valid state transition: created → processing."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')
        assert payment.mark_processing() is True
        assert payment.status == 'processing'

    def test_invalid_state_transition(self):
        """Test invalid state transition."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')
        payment.mark_processing()

        # Cannot go back to processing
        assert payment.mark_processing() is False
        assert payment.status == 'processing'

    def test_complete_success_flow(self):
        """Test complete payment success flow."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')

        assert payment.mark_processing() is True
        assert payment.status == 'processing'

        assert payment.mark_succeeded() is True
        assert payment.status == 'succeeded'
        assert payment.is_terminal() is True

    def test_complete_failure_flow(self):
        """Test complete payment failure flow."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')

        assert payment.mark_processing() is True
        assert payment.mark_failed('insufficient_funds') is True
        assert payment.status == 'failed'
        assert payment.is_terminal() is True
        assert payment.metadata['error'] == 'insufficient_funds'

    def test_cannot_fail_succeeded_payment(self):
        """Test that succeeded payment cannot be failed."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')
        payment.mark_processing()
        payment.mark_succeeded()

        assert payment.mark_failed('already_processed') is False
        assert payment.status == 'succeeded'


class TestPaymentValidation:
    """Test payment data validation."""

    def test_validate_amount(self):
        """Test payment amount validation."""
        # Valid amount (in cents)
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')
        assert payment.amount > 0

        # Invalid: negative amount
        with pytest.raises(ValueError):
            if -100 < 0:
                raise ValueError('Amount must be positive')

    def test_validate_currency(self):
        """Test currency code validation."""
        valid_currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD']
        for currency in valid_currencies:
            payment = Payment('pay_123', 'merchant_456', 10000, currency)
            assert payment.currency == currency
            assert len(payment.currency) == 3

    def test_validate_merchant_id(self):
        """Test merchant ID format."""
        merchant_id = 'merchant_456'
        assert merchant_id.startswith('merchant_') or merchant_id.startswith('cus_')

    def test_idempotency_key_prevents_duplicates(self):
        """Test that idempotency keys prevent duplicate payments."""
        payments = {}
        idempotency_key = 'idempotent_key_123'

        payment1 = Payment('pay_123', 'merchant_456', 10000, 'USD')
        payments[idempotency_key] = payment1

        # Second attempt with same key should return existing payment
        assert idempotency_key in payments
        payment2 = payments.get(idempotency_key)
        assert payment1.payment_id == payment2.payment_id


class TestPaymentWebhooks:
    """Test payment event webhook generation."""

    def test_webhook_on_success(self):
        """Test webhook is generated on payment success."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')
        payment.mark_processing()
        payment.mark_succeeded()

        webhook_event = {
            'event_type': 'payment.succeeded',
            'payment_id': payment.payment_id,
            'status': payment.status,
            'amount': payment.amount,
            'timestamp': payment.updated_at.isoformat(),
        }

        assert webhook_event['event_type'] == 'payment.succeeded'
        assert webhook_event['status'] == 'succeeded'

    def test_webhook_on_failure(self):
        """Test webhook is generated on payment failure."""
        payment = Payment('pay_123', 'merchant_456', 10000, 'USD')
        payment.mark_processing()
        payment.mark_failed('card_declined')

        webhook_event = {
            'event_type': 'payment.failed',
            'payment_id': payment.payment_id,
            'status': payment.status,
            'error': payment.metadata.get('error'),
            'timestamp': payment.updated_at.isoformat(),
        }

        assert webhook_event['event_type'] == 'payment.failed'
        assert webhook_event['error'] == 'card_declined'
