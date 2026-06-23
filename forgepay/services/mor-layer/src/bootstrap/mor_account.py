"""
Bootstrap: ensure the MOR operating account exists in bank-connectivity.

On startup, checks if 'MOR_OPERATING' exists as an internal account.
If not, creates it as a virtual account (no real bank linking needed for
internal-only transfers — it represents ForgePay's own treasury account).
"""

import asyncio
import httpx
import logging

logger = logging.getLogger(__name__)

MOR_OPERATING_ID = "MOR_OPERATING"

async def ensure_mor_operating_account(
    bank_connectivity_url: str,
    internal_secret: str,
) -> bool:
    """Returns True if account exists or was created, False on failure."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        # Check if already exists
        try:
            resp = await client.get(
                f"{bank_connectivity_url}/api/v1/transfers/internal/accounts/{MOR_OPERATING_ID}",
                headers={
                    "x-source": "mor-layer",
                    "x-internal-secret": internal_secret,
                },
            )
            if resp.status_code == 200:
                logger.info("[bootstrap] MOR_OPERATING account already exists")
                return True
        except Exception:
            pass  # endpoint may not exist yet — fall through to create

        # Create the virtual operating account
        try:
            resp = await client.post(
                f"{bank_connectivity_url}/api/v1/transfers/internal/accounts",
                headers={
                    "Content-Type": "application/json",
                    "x-source": "mor-layer",
                    "x-internal-secret": internal_secret,
                },
                json={
                    "id": MOR_OPERATING_ID,
                    "accountName": "ForgePay MoR Operating Account",
                    "accountType": "virtual",
                    "currency": "USD",
                    "description": "Source account for tax remittance transfers",
                },
            )
            if resp.status_code in (200, 201):
                logger.info("[bootstrap] MOR_OPERATING account created successfully")
                return True
            else:
                logger.warning(
                    f"[bootstrap] MOR_OPERATING account creation returned {resp.status_code}: {resp.text[:200]}"
                )
                return False
        except Exception as e:
            logger.warning(f"[bootstrap] Could not create MOR_OPERATING account: {e}")
            return False
