"""
Tests for the compliance-monitor screening, monitoring rules, and risk scoring.

These tests are designed to run without network access — they use synthetic
XML that mirrors the real OFAC SDN XML schema to test parsing and matching.

Run with:
    cd forgepay/services/compliance-monitor
    pytest tests/ -v
"""

from __future__ import annotations

import asyncio
import textwrap
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.monitoring.rules import (
    CryptoLayeringRule,
    DormantAccountSpikeRule,
    HighRiskJurisdictionRule,
    LargeSingleTransactionRule,
    RapidSuccessionRule,
    RoundAmountPatternRule,
    StructuringRule,
    VelocitySpikeRule,
    build_default_ruleset,
)
from src.sanctions.ofac import OfacListManager, _normalise


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Synthetic OFAC SDN XML that mirrors the real Treasury.gov schema.
# Includes:
#   - An individual ("ALI HASSAN AL-RASHID") on IRAN program
#   - An entity ("OMEGA TRADING LLC") on CYBER program
#   - A crypto address entry for ETH
_SYNTHETIC_SDN_XML = textwrap.dedent("""\
    <?xml version="1.0" encoding="UTF-8"?>
    <sdnList>
      <publshInformation>
        <Publish_Date>05/12/2026</Publish_Date>
        <Record_Count>3</Record_Count>
      </publshInformation>
      <sdnEntry>
        <uid>99001</uid>
        <lastName>AL-RASHID</lastName>
        <firstName>ALI HASSAN</firstName>
        <sdnType>Individual</sdnType>
        <programList>
          <program>IRAN</program>
          <program>SDGT</program>
        </programList>
        <akaList>
          <aka>
            <type>a.k.a.</type>
            <lastName>AL RASHEED</lastName>
            <firstName>ALI</firstName>
          </aka>
          <aka>
            <type>a.k.a.</type>
            <lastName>RASHID</lastName>
            <firstName>ALI H.</firstName>
          </aka>
        </akaList>
        <addressList>
          <address>
            <country>Iran</country>
          </address>
        </addressList>
      </sdnEntry>
      <sdnEntry>
        <uid>99002</uid>
        <lastName>OMEGA TRADING LLC</lastName>
        <firstName/>
        <sdnType>Entity</sdnType>
        <programList>
          <program>CYBER</program>
        </programList>
        <akaList>
          <aka>
            <type>a.k.a.</type>
            <lastName>OMEGA TRADE</lastName>
            <firstName/>
          </aka>
        </akaList>
        <addressList>
          <address>
            <country>Russia</country>
          </address>
        </addressList>
      </sdnEntry>
      <sdnEntry>
        <uid>99003</uid>
        <lastName>CRYPTO LAUNDERER INC</lastName>
        <firstName/>
        <sdnType>Entity</sdnType>
        <programList>
          <program>DARKNETS</program>
        </programList>
        <idList>
          <id>
            <idType>Digital Currency Address - ETH</idType>
            <idNumber>0xDeAdBeEf1234567890AbCdEf1234567890AbCdEf</idNumber>
          </id>
          <id>
            <idType>Digital Currency Address - BTC</idType>
            <idNumber>1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf</idNumber>
          </id>
        </idList>
      </sdnEntry>
    </sdnList>
""").encode("utf-8")


@pytest.fixture
def ofac_manager_loaded() -> OfacListManager:
    """Return an OfacListManager pre-loaded with synthetic SDN data."""
    manager = OfacListManager(sdn_url="https://fake.treasury.gov/sdn.xml")
    entries, token_index, crypto_index = OfacListManager._parse_xml(_SYNTHETIC_SDN_XML)
    manager._entries = entries
    manager._token_index = token_index
    manager._crypto_index = crypto_index
    import time
    manager._last_updated = time.time()
    return manager


def _make_txn(
    txn_id: str = "txn-001",
    merchant_id: str = "merch-001",
    amount_usd: float = 100.0,
    payment_method: str = "card",
    payer_country: str = "US",
    payer_ip_country: str = "US",
    created_at: str | None = None,
) -> dict[str, Any]:
    if created_at is None:
        created_at = datetime.now(timezone.utc).isoformat()
    return {
        "id": txn_id,
        "merchant_id": merchant_id,
        "amount_usd": amount_usd,
        "amount": amount_usd,
        "currency": "USD",
        "payment_method": payment_method,
        "payer_country": payer_country,
        "payer_ip_country": payer_ip_country,
        "created_at": created_at,
        "metadata": {},
    }


def _ts_offset(minutes: int = 0, days: int = 0) -> str:
    """Return an ISO-8601 UTC string offset from now by the given delta."""
    dt = datetime.now(timezone.utc) - timedelta(minutes=minutes, days=days)
    return dt.isoformat()


# ---------------------------------------------------------------------------
# OFAC XML parsing tests
# ---------------------------------------------------------------------------


class TestOfacParsing:
    def test_parse_entry_count(self, ofac_manager_loaded: OfacListManager) -> None:
        assert ofac_manager_loaded.entry_count() == 3

    def test_parse_individual_primary_name(self, ofac_manager_loaded: OfacListManager) -> None:
        entries = ofac_manager_loaded._entries
        individual = next(e for e in entries if e.uid == "99001")
        # firstName comes before lastName in the _build_name helper
        assert "ALI HASSAN" in individual.primary_name
        assert "AL-RASHID" in individual.primary_name

    def test_parse_individual_programs(self, ofac_manager_loaded: OfacListManager) -> None:
        entries = ofac_manager_loaded._entries
        individual = next(e for e in entries if e.uid == "99001")
        assert "IRAN" in individual.programs
        assert "SDGT" in individual.programs

    def test_parse_entity_type(self, ofac_manager_loaded: OfacListManager) -> None:
        entries = ofac_manager_loaded._entries
        entity = next(e for e in entries if e.uid == "99002")
        assert entity.sdn_type == "Entity"

    def test_parse_aliases(self, ofac_manager_loaded: OfacListManager) -> None:
        entries = ofac_manager_loaded._entries
        individual = next(e for e in entries if e.uid == "99001")
        assert len(individual.aliases) == 2

    def test_parse_crypto_addresses(self, ofac_manager_loaded: OfacListManager) -> None:
        entries = ofac_manager_loaded._entries
        crypto_entity = next(e for e in entries if e.uid == "99003")
        assert len(crypto_entity.crypto_addresses) == 2
        assert any("DeAdBeEf" in addr for addr in crypto_entity.crypto_addresses)

    def test_crypto_index_populated(self, ofac_manager_loaded: OfacListManager) -> None:
        # Crypto index uses lowercase keys
        assert "0xdeadbeef1234567890abcdef1234567890abcdef" in ofac_manager_loaded._crypto_index


# ---------------------------------------------------------------------------
# OFAC name matching tests
# ---------------------------------------------------------------------------


class TestOfacNameMatching:
    def test_exact_name_match(self, ofac_manager_loaded: OfacListManager) -> None:
        matches = ofac_manager_loaded.search("ALI HASSAN AL-RASHID", threshold=0.85)
        assert len(matches) >= 1
        assert matches[0].entry_id == "99001"
        assert matches[0].similarity_score >= 0.95

    def test_alias_match(self, ofac_manager_loaded: OfacListManager) -> None:
        # "ALI AL RASHEED" should match the a.k.a. entry
        matches = ofac_manager_loaded.search("ALI AL RASHEED", threshold=0.75)
        assert len(matches) >= 1
        assert any(m.entry_id == "99001" for m in matches)

    def test_entity_match_with_noise_words_stripped(
        self, ofac_manager_loaded: OfacListManager
    ) -> None:
        # "LLC" is a noise word; should still match "OMEGA TRADING LLC"
        matches = ofac_manager_loaded.search("Omega Trading", threshold=0.80)
        assert len(matches) >= 1
        assert matches[0].entry_id == "99002"

    def test_partial_match_below_threshold(self, ofac_manager_loaded: OfacListManager) -> None:
        # "John Smith" should not match SDN entries at default threshold
        matches = ofac_manager_loaded.search("John Smith", threshold=0.85)
        assert len(matches) == 0

    def test_typo_tolerance(self, ofac_manager_loaded: OfacListManager) -> None:
        # "ALI HASAN AL-RASID" (missing letters) should still match
        matches = ofac_manager_loaded.search("ALI HASAN AL-RASID", threshold=0.80)
        assert len(matches) >= 1
        assert any(m.entry_id == "99001" for m in matches)

    def test_known_sdnt_entity_match(self, ofac_manager_loaded: OfacListManager) -> None:
        # "OMEGA TRADE" is an explicit alias of uid 99002
        matches = ofac_manager_loaded.search("OMEGA TRADE", threshold=0.85)
        assert len(matches) >= 1
        assert any(m.entry_id == "99002" for m in matches)

    def test_match_list_name_is_ofac_sdn(self, ofac_manager_loaded: OfacListManager) -> None:
        matches = ofac_manager_loaded.search("ALI HASSAN AL-RASHID", threshold=0.85)
        assert all(m.list_name == "OFAC_SDN" for m in matches)

    def test_programs_returned_in_match(self, ofac_manager_loaded: OfacListManager) -> None:
        matches = ofac_manager_loaded.search("ALI HASSAN AL-RASHID", threshold=0.85)
        programs = matches[0].programs
        assert "IRAN" in programs

    def test_empty_query_returns_empty(self, ofac_manager_loaded: OfacListManager) -> None:
        assert ofac_manager_loaded.search("") == []
        assert ofac_manager_loaded.search("   ") == []


# ---------------------------------------------------------------------------
# Crypto address matching tests
# ---------------------------------------------------------------------------


class TestCryptoAddressMatching:
    def test_exact_eth_address_match(self, ofac_manager_loaded: OfacListManager) -> None:
        matches = ofac_manager_loaded.check_crypto_address(
            "0xDeAdBeEf1234567890AbCdEf1234567890AbCdEf"
        )
        assert len(matches) == 1
        assert matches[0].entry_id == "99003"
        assert matches[0].similarity_score == 1.0

    def test_lowercase_address_match(self, ofac_manager_loaded: OfacListManager) -> None:
        # The index is case-insensitive
        matches = ofac_manager_loaded.check_crypto_address(
            "0xdeadbeef1234567890abcdef1234567890abcdef"
        )
        assert len(matches) == 1

    def test_unknown_address_no_match(self, ofac_manager_loaded: OfacListManager) -> None:
        matches = ofac_manager_loaded.check_crypto_address("0x0000000000000000000000000000000000000000")
        assert len(matches) == 0

    def test_btc_address_match(self, ofac_manager_loaded: OfacListManager) -> None:
        matches = ofac_manager_loaded.check_crypto_address(
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf"
        )
        assert len(matches) == 1
        assert matches[0].entry_id == "99003"


# ---------------------------------------------------------------------------
# Name normalisation tests
# ---------------------------------------------------------------------------


class TestNormalisation:
    def test_strips_punctuation(self) -> None:
        assert _normalise("AL-RASHID, ALI") == "al rashid ali"

    def test_strips_noise_words(self) -> None:
        assert _normalise("Omega Trading LLC") == "omega trading"

    def test_lowercases(self) -> None:
        assert _normalise("JOHN SMITH") == "john smith"

    def test_collapses_whitespace(self) -> None:
        result = _normalise("  JOHN   SMITH  ")
        assert result == "john smith"


# ---------------------------------------------------------------------------
# AML structuring rule tests
# ---------------------------------------------------------------------------


class TestStructuringRule:
    def setup_method(self) -> None:
        self.rule = StructuringRule(threshold_usd=10_000.0)

    def test_structuring_triggers_with_multiple_just_below_threshold(self) -> None:
        """Two transactions in $9,900–$9,999 range within 24h → triggers."""
        now = datetime.now(timezone.utc)
        txn = _make_txn(txn_id="txn-1", amount_usd=9_950.0, created_at=now.isoformat())
        history = [
            txn,
            _make_txn(
                txn_id="txn-0",
                amount_usd=9_920.0,
                created_at=(now - timedelta(hours=2)).isoformat(),
            ),
        ]
        result = self.rule.evaluate(txn, history)
        assert result is not None
        assert result.rule_id == "AML-001"
        assert result.category == "structuring"
        assert result.triggered_values["transactions_in_24h"] >= 2

    def test_structuring_does_not_trigger_for_single_transaction(self) -> None:
        """Only one below-threshold transaction → no trigger."""
        txn = _make_txn(amount_usd=9_950.0)
        # No history besides current transaction
        result = self.rule.evaluate(txn, [txn])
        assert result is None

    def test_structuring_does_not_trigger_above_threshold(self) -> None:
        txn = _make_txn(amount_usd=10_100.0)
        result = self.rule.evaluate(txn, [txn])
        assert result is None

    def test_structuring_does_not_trigger_well_below_band(self) -> None:
        """$5,000 is well below the $9,900 lower band."""
        txn = _make_txn(amount_usd=5_000.0)
        result = self.rule.evaluate(txn, [txn])
        assert result is None

    def test_structuring_severity_is_high(self) -> None:
        assert self.rule.severity == "high"

    def test_structuring_older_transactions_outside_24h_not_counted(self) -> None:
        """Second transaction is 25h ago — should NOT count toward threshold."""
        now = datetime.now(timezone.utc)
        txn = _make_txn(txn_id="txn-1", amount_usd=9_950.0, created_at=now.isoformat())
        old = _make_txn(
            txn_id="txn-0",
            amount_usd=9_950.0,
            created_at=(now - timedelta(hours=25)).isoformat(),
        )
        result = self.rule.evaluate(txn, [txn, old])
        # Only the current transaction falls in the 24h window → count < 2 → no trigger
        assert result is None


# ---------------------------------------------------------------------------
# AML high-risk jurisdiction rule tests
# ---------------------------------------------------------------------------


class TestHighRiskJurisdictionRule:
    def setup_method(self) -> None:
        self.rule = HighRiskJurisdictionRule()

    def test_iran_triggers(self) -> None:
        txn = _make_txn(payer_country="IR")
        result = self.rule.evaluate(txn, [txn])
        assert result is not None
        assert result.rule_id == "AML-003"
        assert result.severity == "critical"

    def test_north_korea_triggers(self) -> None:
        txn = _make_txn(payer_ip_country="KP")
        result = self.rule.evaluate(txn, [txn])
        assert result is not None

    def test_us_does_not_trigger(self) -> None:
        txn = _make_txn(payer_country="US", payer_ip_country="US")
        result = self.rule.evaluate(txn, [txn])
        assert result is None

    def test_russia_triggers(self) -> None:
        txn = _make_txn(payer_country="RU")
        result = self.rule.evaluate(txn, [txn])
        assert result is not None

    def test_ip_country_triggers_independently(self) -> None:
        txn = _make_txn(payer_country="DE", payer_ip_country="SY")
        result = self.rule.evaluate(txn, [txn])
        assert result is not None
        assert "SY" in result.triggered_values["high_risk_countries_matched"]


# ---------------------------------------------------------------------------
# AML large single transaction rule tests
# ---------------------------------------------------------------------------


class TestLargeSingleTransactionRule:
    def setup_method(self) -> None:
        self.rule = LargeSingleTransactionRule(threshold_usd=50_000.0)

    def test_above_threshold_triggers(self) -> None:
        txn = _make_txn(amount_usd=75_000.0)
        result = self.rule.evaluate(txn, [txn])
        assert result is not None
        assert result.rule_id == "AML-004"

    def test_at_threshold_no_trigger(self) -> None:
        txn = _make_txn(amount_usd=50_000.0)
        result = self.rule.evaluate(txn, [txn])
        assert result is None

    def test_below_threshold_no_trigger(self) -> None:
        txn = _make_txn(amount_usd=25_000.0)
        result = self.rule.evaluate(txn, [txn])
        assert result is None

    def test_excess_amount_reported(self) -> None:
        txn = _make_txn(amount_usd=60_000.0)
        result = self.rule.evaluate(txn, [txn])
        assert result is not None
        assert result.triggered_values["excess_usd"] == 10_000.0


# ---------------------------------------------------------------------------
# AML rapid succession rule tests
# ---------------------------------------------------------------------------


class TestRapidSuccessionRule:
    def setup_method(self) -> None:
        self.rule = RapidSuccessionRule()

    def test_three_same_amounts_in_10min_triggers(self) -> None:
        now = datetime.now(timezone.utc)
        txns = [
            _make_txn(txn_id=f"txn-{i}", amount_usd=500.0,
                      created_at=(now - timedelta(minutes=i)).isoformat())
            for i in range(3)
        ]
        result = self.rule.evaluate(txns[0], txns)
        assert result is not None
        assert result.rule_id == "AML-005"

    def test_two_same_amounts_no_trigger(self) -> None:
        now = datetime.now(timezone.utc)
        txns = [
            _make_txn(txn_id=f"txn-{i}", amount_usd=500.0,
                      created_at=(now - timedelta(minutes=i)).isoformat())
            for i in range(2)
        ]
        result = self.rule.evaluate(txns[0], txns)
        assert result is None


# ---------------------------------------------------------------------------
# AML dormant account spike tests
# ---------------------------------------------------------------------------


class TestDormantAccountSpikeRule:
    def setup_method(self) -> None:
        self.rule = DormantAccountSpikeRule()

    def test_dormant_account_large_txn_triggers(self) -> None:
        now = datetime.now(timezone.utc)
        # Last transaction was 45 days ago
        old_txn = _make_txn(
            txn_id="txn-old",
            amount_usd=100.0,
            created_at=(now - timedelta(days=45)).isoformat(),
        )
        current = _make_txn(txn_id="txn-new", amount_usd=7_000.0, created_at=now.isoformat())
        result = self.rule.evaluate(current, [current, old_txn])
        assert result is not None
        assert result.rule_id == "AML-006"

    def test_active_account_no_trigger(self) -> None:
        now = datetime.now(timezone.utc)
        recent = _make_txn(
            txn_id="txn-recent",
            amount_usd=100.0,
            created_at=(now - timedelta(days=5)).isoformat(),
        )
        current = _make_txn(txn_id="txn-new", amount_usd=7_000.0, created_at=now.isoformat())
        result = self.rule.evaluate(current, [current, recent])
        assert result is None

    def test_small_amount_dormant_no_trigger(self) -> None:
        now = datetime.now(timezone.utc)
        old_txn = _make_txn(
            txn_id="txn-old",
            amount_usd=100.0,
            created_at=(now - timedelta(days=45)).isoformat(),
        )
        current = _make_txn(txn_id="txn-new", amount_usd=100.0, created_at=now.isoformat())
        result = self.rule.evaluate(current, [current, old_txn])
        assert result is None


# ---------------------------------------------------------------------------
# AML velocity spike rule tests
# ---------------------------------------------------------------------------


class TestVelocitySpikeRule:
    def setup_method(self) -> None:
        self.rule = VelocitySpikeRule()

    def test_velocity_spike_triggers(self) -> None:
        now = datetime.now(timezone.utc)
        # Build a 30-day baseline: 1 transaction every 2 hours = 0.5/h avg
        baseline = [
            _make_txn(
                txn_id=f"base-{i}",
                amount_usd=100.0,
                created_at=(now - timedelta(hours=i * 2)).isoformat(),
            )
            for i in range(1, 361)  # 360 txns over 720h → 0.5/h avg
        ]
        # Current hour: 10 transactions (10 / 0.5 = 20x spike)
        recent = [
            _make_txn(
                txn_id=f"recent-{i}",
                amount_usd=100.0,
                created_at=(now - timedelta(minutes=i * 5)).isoformat(),
            )
            for i in range(10)
        ]
        all_txns = recent + baseline
        result = self.rule.evaluate(recent[0], all_txns)
        assert result is not None
        assert result.rule_id == "AML-002"
        assert result.triggered_values["spike_ratio"] > 3.0

    def test_no_spike_no_trigger(self) -> None:
        now = datetime.now(timezone.utc)
        # 1 transaction per hour, stable — no spike
        txns = [
            _make_txn(
                txn_id=f"txn-{i}",
                amount_usd=100.0,
                created_at=(now - timedelta(hours=i)).isoformat(),
            )
            for i in range(720)
        ]
        result = self.rule.evaluate(txns[0], txns)
        assert result is None


# ---------------------------------------------------------------------------
# AML round amount pattern tests
# ---------------------------------------------------------------------------


class TestRoundAmountPatternRule:
    def setup_method(self) -> None:
        self.rule = RoundAmountPatternRule()

    def test_five_round_amounts_triggers(self) -> None:
        now = datetime.now(timezone.utc)
        txns = [
            _make_txn(
                txn_id=f"txn-{i}",
                amount_usd=float(round_val),
                created_at=(now - timedelta(hours=i)).isoformat(),
            )
            for i, round_val in enumerate([500, 1000, 500, 200, 100])
        ]
        result = self.rule.evaluate(txns[0], txns)
        assert result is not None
        assert result.rule_id == "AML-008"

    def test_non_round_amount_no_trigger(self) -> None:
        txn = _make_txn(amount_usd=523.47)
        result = self.rule.evaluate(txn, [txn])
        assert result is None

    def test_fewer_than_five_round_amounts_no_trigger(self) -> None:
        now = datetime.now(timezone.utc)
        txns = [
            _make_txn(
                txn_id=f"txn-{i}",
                amount_usd=float(v),
                created_at=(now - timedelta(hours=i)).isoformat(),
            )
            for i, v in enumerate([500, 1000, 300])
        ]
        result = self.rule.evaluate(txns[0], txns)
        assert result is None


# ---------------------------------------------------------------------------
# Risk score calculation tests
# ---------------------------------------------------------------------------


class TestRiskScoreCalculation:
    """Test that the monitoring engine risk score computes correctly."""

    def _rule_to_monitoring(self, rule_id: str, severity: str):
        from src.models import MonitoringRule
        return MonitoringRule(
            rule_id=rule_id,
            rule_name=f"Rule {rule_id}",
            category="unusual_pattern",
            severity=severity,
            description="test",
            triggered_values={},
        )

    def test_no_rules_score_zero(self) -> None:
        from src.monitoring.engine import _compute_risk_score
        assert _compute_risk_score([]) == 0

    def test_single_medium_rule_scores_15(self) -> None:
        from src.monitoring.engine import _compute_risk_score
        rules = [self._rule_to_monitoring("AML-001", "medium")]
        assert _compute_risk_score(rules) == 15

    def test_single_critical_rule_scores_50(self) -> None:
        from src.monitoring.engine import _compute_risk_score
        rules = [self._rule_to_monitoring("AML-003", "critical")]
        assert _compute_risk_score(rules) == 50

    def test_multiple_rules_sum_capped_at_100(self) -> None:
        from src.monitoring.engine import _compute_risk_score
        rules = [
            self._rule_to_monitoring("AML-003", "critical"),  # 50
            self._rule_to_monitoring("AML-004", "high"),      # 30
            self._rule_to_monitoring("AML-002", "medium"),    # 15
            self._rule_to_monitoring("AML-001", "high"),      # 30
        ]  # total = 125, capped at 100
        assert _compute_risk_score(rules) == 100

    def test_decision_block_at_70(self) -> None:
        from src.monitoring.engine import _decide
        assert _decide(70) == "block"
        assert _decide(100) == "block"

    def test_decision_review_between_30_and_70(self) -> None:
        from src.monitoring.engine import _decide
        assert _decide(30) == "review"
        assert _decide(69) == "review"

    def test_decision_allow_below_30(self) -> None:
        from src.monitoring.engine import _decide
        assert _decide(0) == "allow"
        assert _decide(29) == "allow"

    def test_requires_sar_above_threshold(self) -> None:
        from src.monitoring.engine import _requires_sar
        assert _requires_sar(50, [], sar_threshold=50) is True
        assert _requires_sar(49, [], sar_threshold=50) is False

    def test_requires_sar_on_critical_rule(self) -> None:
        from src.monitoring.engine import _requires_sar
        critical = self._rule_to_monitoring("AML-003", "critical")
        assert _requires_sar(20, [critical], sar_threshold=50) is True


# ---------------------------------------------------------------------------
# Ruleset completeness test
# ---------------------------------------------------------------------------


class TestRuleset:
    def test_default_ruleset_has_eight_rules(self) -> None:
        rules = build_default_ruleset()
        assert len(rules) == 8

    def test_all_rules_have_required_attributes(self) -> None:
        rules = build_default_ruleset()
        for rule in rules:
            assert rule.rule_id, f"Missing rule_id on {rule}"
            assert rule.rule_name, f"Missing rule_name on {rule}"
            assert rule.category in (
                "structuring", "velocity", "high_risk_jurisdiction", "layering", "unusual_pattern"
            ), f"Unknown category on {rule.rule_id}"
            assert rule.severity in ("low", "medium", "high", "critical"), (
                f"Unknown severity on {rule.rule_id}"
            )

    def test_rule_ids_are_unique(self) -> None:
        rules = build_default_ruleset()
        ids = [r.rule_id for r in rules]
        assert len(ids) == len(set(ids)), "Duplicate rule IDs detected"
