# liquidity-forecaster

7/30/90-day cash-flow forecasting, runway calculation, and real-time liquidity
alerts for ForgePay merchants.

Pulls payment and billing history from `payment-engine`, `billing-engine`,
`stablecoin-gateway` and `crypto-gateway`, and combines an ARIMA and a
Holt-Winters forecast into a single ensemble weighted by inverse-MAPE on a
30-day hold-out. See `src/main.py` for the full endpoint and auth model.

## Develop

```bash
poetry install
poetry run uvicorn src.main:app --reload
poetry run pytest tests/ -v
```

`pyproject.toml` pins Python `^3.12`.
