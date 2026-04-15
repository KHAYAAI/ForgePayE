# forgepay-python

Official Python SDK for the ForgePay API.

## Installation

```bash
pip install forgepay
```

## Quick Start

```python
import forgepay

forgepay.api_key = "fpk_live_..."

# Create a payment
payment = forgepay.Payment.create(
    amount=2000,
    currency="USD",
    payment_method="card",
    customer_id="cus_123",
    idempotency_key="order_xyz_001",
)

# Create a subscription
subscription = forgepay.Subscription.create(
    customer_id="cus_123",
    plan_id="plan_pro_monthly",
    trial_days=14,
)

# Accept stablecoin (USDC on Base)
stablecoin_payment = forgepay.Stablecoin.create(
    amount="99.00",
    currency="USDC",
    chain="base",
    customer_id="cus_123",
)
```

## Async Support

```python
import asyncio
import forgepay

async def main():
    client = forgepay.AsyncForgePay(api_key="fpk_live_...")
    payment = await client.payments.create(amount=2000, currency="USD", ...)

asyncio.run(main())
```
