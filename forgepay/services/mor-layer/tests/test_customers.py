"""
Auth tests for POST /v1/customers/ and its GET routes.

create_customer used to have no auth dependency at all — any caller could
create a customer record tagged to an arbitrary merchant_id. These tests
cover the fix: an authenticated merchant can create a customer for itself,
cannot create one for a different merchant_id, and an unauthenticated
caller is rejected outright. retrieve_customer/list_payment_methods only
require *some* valid merchant identity (Hyperswitch customers aren't
mirrored locally, so true per-customer ownership can't be checked here —
see the comment in customers.py) but must still reject anonymous callers.
"""

import respx
import httpx
import pytest
from httpx import AsyncClient

CUSTOMER_RESPONSE = {
    "customer_id": "cus_hs_01",
    "merchant_reference_id": "ref_01",
    "email": "buyer@example.com",
    "name": None,
    "phone": None,
    "created_at": "2026-01-01T00:00:00Z",
}


def customer_payload(merchant_id: str, **overrides) -> dict:
    payload = {
        "merchant_id": merchant_id,
        "reference_id": "ref_01",
        "email": "buyer@example.com",
    }
    payload.update(overrides)
    return payload


@respx.mock
@pytest.mark.asyncio
async def test_create_customer_succeeds_for_own_merchant(client: AsyncClient, merchant: dict):
    respx.post("http://hyperswitch-test.local/customers").mock(
        return_value=httpx.Response(200, json=CUSTOMER_RESPONSE)
    )
    resp = await client.post(
        "/v1/customers/", json=customer_payload(merchant["id"]), headers=merchant["headers"],
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_create_customer_rejects_merchant_id_mismatch(client: AsyncClient, merchant: dict):
    resp = await client.post(
        "/v1/customers/", json=customer_payload("merch_someone_else"), headers=merchant["headers"],
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_customer_rejects_unauthenticated(client: AsyncClient):
    resp = await client.post("/v1/customers/", json=customer_payload("merch_test_01"))
    assert resp.status_code == 401


@respx.mock
@pytest.mark.asyncio
async def test_retrieve_customer_succeeds_when_authenticated(client: AsyncClient, merchant: dict):
    respx.get("http://hyperswitch-test.local/customers/cus_hs_01").mock(
        return_value=httpx.Response(200, json=CUSTOMER_RESPONSE)
    )
    resp = await client.get("/v1/customers/cus_hs_01", headers=merchant["headers"])
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_retrieve_customer_rejects_unauthenticated(client: AsyncClient):
    resp = await client.get("/v1/customers/cus_hs_01")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_payment_methods_rejects_unauthenticated(client: AsyncClient):
    resp = await client.get("/v1/customers/cus_hs_01/payment_methods")
    assert resp.status_code == 401
