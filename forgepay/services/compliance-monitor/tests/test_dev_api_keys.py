"""
Regression: register_api_key() was documented as "called at startup or when
a key is provisioned" and nothing ever called it. The in-memory store stayed
permanently empty in every environment, so no caller could authenticate via
API key at all -- every X-Compliance-API-Key request fell straight through
to the 401 at the bottom of require_auth(), indistinguishable from a caller
that sent no credential whatsoever.

This exercises the two things that actually matter: a key registered via
DEV_API_KEYS is accepted by require_auth(), and Settings refuses to
construct at all if DEV_API_KEYS is set alongside environment=production --
a plaintext key baked into a deploy manifest is exactly the mistake that
guard exists to catch before it ships anywhere near a real deployment.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from src.auth import _API_KEY_STORE, register_api_key, require_auth
from src.config import Settings


@pytest.fixture(autouse=True)
def _clean_key_store():
    """The store is a module-level dict; do not let one test's keys leak
    into the next."""
    _API_KEY_STORE.clear()
    yield
    _API_KEY_STORE.clear()


class TestDevApiKeysParsing:
    def test_parses_well_formed_pairs(self) -> None:
        s = Settings(dev_api_keys="abc123:bureau,def456:gateway")
        assert s.dev_api_keys_list == [("abc123", "bureau"), ("def456", "gateway")]

    def test_empty_string_parses_to_no_pairs(self) -> None:
        assert Settings(dev_api_keys="").dev_api_keys_list == []

    def test_skips_a_malformed_entry_rather_than_raising(self) -> None:
        # One bad entry in a dev-only convenience variable should not take
        # the whole service down at startup.
        s = Settings(dev_api_keys="good:bureau,no-colon-here,also-good:gateway")
        assert s.dev_api_keys_list == [("good", "bureau"), ("also-good", "gateway")]

    def test_tolerates_stray_whitespace(self) -> None:
        s = Settings(dev_api_keys=" abc123 : bureau , def456:gateway ")
        assert s.dev_api_keys_list == [("abc123", "bureau"), ("def456", "gateway")]


class TestProductionRefusesDevKeys:
    def test_dev_api_keys_set_in_production_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="DEV_API_KEYS must not be set in production"):
            Settings(
                environment="production",
                jwt_secret="a" * 32,
                internal_service_secret="something",
                dev_api_keys="abc123:bureau",
            )

    def test_production_is_fine_with_dev_api_keys_unset(self) -> None:
        # Confirms the new check is additive -- does not break the existing
        # production-boot path when DEV_API_KEYS is simply absent.
        Settings(
            environment="production",
            jwt_secret="a" * 32,
            internal_service_secret="something",
        )


class TestSeededKeyIsAcceptedByRequireAuth:
    @pytest.mark.asyncio
    async def test_a_registered_key_authenticates(self) -> None:
        register_api_key("the-raw-key", merchant_id="agent-credit-bureau")

        caller = await require_auth(credentials=None, x_compliance_api_key="the-raw-key")

        assert caller["merchant_id"] == "agent-credit-bureau"
        assert caller["auth_method"] == "api_key"

    @pytest.mark.asyncio
    async def test_an_unregistered_key_is_still_401(self) -> None:
        # The fix is that a registered key works -- not that the check got
        # loosened for everyone else.
        register_api_key("the-real-key", merchant_id="agent-credit-bureau")

        with pytest.raises(HTTPException) as exc_info:
            await require_auth(credentials=None, x_compliance_api_key="a-guessed-key")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_no_credential_at_all_is_still_401(self) -> None:
        with pytest.raises(HTTPException) as exc_info:
            await require_auth(credentials=None, x_compliance_api_key=None)

        assert exc_info.value.status_code == 401
