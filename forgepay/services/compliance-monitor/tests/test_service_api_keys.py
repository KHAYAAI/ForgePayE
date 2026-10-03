"""
Production service credentials. DEV_API_KEYS is (rightly) refused in production, which left NO way for a caller such as the
credit bureau to authenticate with an API key there: its screening calls would 401 and the bureau, which fails closed,
could not screen anything. SERVICE_API_KEY_HASHES provisions callers by SHA-256 only, and is allowed in production.
"""

from __future__ import annotations

import asyncio
import hashlib

import pytest
from fastapi import HTTPException

from src.auth import _API_KEY_STORE, register_api_key_hash, require_auth
from src.config import Settings

RAW = "k" * 40
DIGEST = hashlib.sha256(RAW.encode()).hexdigest()
PROD = dict(environment="production", jwt_secret="a" * 32, internal_service_secret="x", database_url="postgresql+asyncpg://u:p@db.prod:5432/cm")


@pytest.fixture(autouse=True)
def _clean():
    _API_KEY_STORE.clear()
    yield
    _API_KEY_STORE.clear()


def test_hash_pairs_parse_and_are_allowed_in_production() -> None:
    s = Settings(service_api_key_hashes=f"{DIGEST}:bureau, {DIGEST.upper()}:gateway", **PROD)
    assert s.service_api_key_hashes_list == [(DIGEST, "bureau"), (DIGEST, "gateway")]


@pytest.mark.parametrize("bad", ["not-a-hash:bureau", f"{DIGEST}", f"{DIGEST}:", "abc:bureau", f"{DIGEST[:-1]}z:bureau"])
def test_a_malformed_entry_stops_the_service_rather_than_being_skipped(bad: str) -> None:
    with pytest.raises(ValueError):
        Settings(service_api_key_hashes=bad, **PROD)


def test_a_registered_hash_authenticates_the_raw_key_and_nothing_else() -> None:
    register_api_key_hash(DIGEST, "bureau")
    ctx = asyncio.run(require_auth(credentials=None, x_compliance_api_key=RAW))
    assert ctx["merchant_id"] == "bureau" and ctx["auth_method"] == "api_key"
    assert "admin" not in ctx["scopes"]  # a service key is not an administrator
    for wrong in (DIGEST, RAW + "x", "other"):  # the hash itself is not a credential
        with pytest.raises(HTTPException) as e:
            asyncio.run(require_auth(credentials=None, x_compliance_api_key=wrong))
        assert e.value.status_code == 401


def test_dev_keys_are_still_refused_in_production() -> None:
    with pytest.raises(ValueError, match="DEV_API_KEYS must not be set in production"):
        Settings(dev_api_keys="abc:bureau", **PROD)
