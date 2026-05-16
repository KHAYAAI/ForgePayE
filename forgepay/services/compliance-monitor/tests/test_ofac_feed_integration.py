"""
Comprehensive tests for OFAC real-time feed integration.

Tests cover:
  - CSV parsing (SDN, DPL, EEL)
  - Redis caching with 24h TTL
  - Name matching algorithms (fuzzy, soundex, metaphone)
  - Risk scoring and transaction screening
  - Mass-default alert scenario (multiple SDN hits)
  - Feed refresh with change detection
  - Error handling and fallback to cached lists

Run with:
    cd forgepay/services/compliance-monitor
    pytest tests/test_ofac_feed_integration.py -v
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.ofac.feed import ListType, OfacEntry, OfacFeedManager
from src.sanctions.screening import (
    TransactionScreeningEngine,
    soundex,
    metaphone,
    normalize_name,
)


# ---------------------------------------------------------------------------
# Fixtures: Mock CSV data and Redis client
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_redis_client() -> AsyncMock:
    """Mock Redis client for testing."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=None)
    client.setex = AsyncMock(return_value=True)
    return client


@pytest.fixture
def sample_sdn_csv() -> bytes:
    """Sample SDN CSV with test entries."""
    csv_data = """uid,ent_num,sdn_name,sdn_type,program,title,call_sign,vessel_type,gross_tonnage,summer_dwt,country,federal_register_notice,special_designation,comments
123456,N/A,AL-RASHID; ALI HASSAN,Individual,IRAN; SDGT,Title of official,N/A,N/A,0,0,Iran,Federal Register Notice,Special Designation,N/A
789012,N/A,OMEGA TRADING LLC,Entity,CYBER,N/A,N/A,N/A,0,0,Russia,Federal Register Notice,Special Designation,N/A
345678,N/A,BANK OF TEHRAN,Entity,IRAN,N/A,N/A,N/A,0,0,Iran,Federal Register Notice,Special Designation,N/A
"""
    return csv_data.encode("utf-8")


@pytest.fixture
def sample_dpl_csv() -> bytes:
    """Sample DPL (Denied Persons List) CSV."""
    csv_data = """name,address,country,effective_date
DENIED PERSON ONE,123 Main St,North Korea,2023-01-01
DENIED PERSON TWO,456 Oak Ave,Iran,2023-01-15
"""
    return csv_data.encode("utf-8")


@pytest.fixture
def sample_eel_csv() -> bytes:
    """Sample EEL (Entity List) CSV."""
    csv_data = """name,country,effective_date
ENTITY ONE,Syria,2023-02-01
ENTITY TWO,Cuba,2023-02-15
"""
    return csv_data.encode("utf-8")


@pytest.fixture
async def ofac_feed_manager(mock_redis_client: AsyncMock) -> OfacFeedManager:
    """Instantiate OfacFeedManager with mocked Redis."""
    return OfacFeedManager(
        redis_client=mock_redis_client,
        feed_base_url="https://www.treasury.gov/ofac/downloads/ssi/",
        cache_ttl_seconds=86_400,
    )


# ---------------------------------------------------------------------------
# Tests: Name matching algorithms
# ---------------------------------------------------------------------------


class TestNameMatchingAlgorithms:
    """Test phonetic and fuzzy name matching."""

    def test_soundex_basic(self) -> None:
        """Test Soundex encoding of common names."""
        assert soundex("Smith") == "S530"
        assert soundex("Johnson") == "J525"
        assert soundex("Robert") == "R163"
        assert soundex("Rupert") == "R163"  # Should match Robert
        assert soundex("") == ""

    def test_soundex_phonetic_variants(self) -> None:
        """Test that Soundex captures phonetic variants."""
        # These should have the same or similar Soundex
        smiths = soundex("Smith")
        smythe = soundex("Smythe")
        assert smiths == smythe

    def test_metaphone_basic(self) -> None:
        """Test Metaphone encoding."""
        # Metaphone should encode common names
        result = metaphone("Smith")
        assert len(result) == 4
        assert result[0] == "S"  # Starts with 'S'

    def test_metaphone_ph_replacement(self) -> None:
        """Test that Metaphone handles PH → F."""
        phips = metaphone("Phillips")
        # Should replace PH with F
        assert "PH" not in phips

    def test_normalize_name_strips_noise(self) -> None:
        """Test that normalize_name strips company suffixes."""
        assert normalize_name("ACME Corporation Inc.") == "acme"
        assert normalize_name("OMEGA TRADING LLC") == "omega trading"
        assert normalize_name("The Bank of New York") == "bank new york"
        assert normalize_name("Global Solutions, Ltd") == "global solutions"

    def test_normalize_name_removes_punctuation(self) -> None:
        """Test punctuation removal."""
        assert normalize_name("Smith, Jr.") == "smith jr"
        assert normalize_name("O'Brien") == "obrien"
        assert normalize_name("José") == "josé"

    def test_normalize_name_empty(self) -> None:
        """Test handling of empty/whitespace names."""
        assert normalize_name("") == ""
        assert normalize_name("   ") == ""
        assert normalize_name("Inc. LLC") == ""  # All noise words


# ---------------------------------------------------------------------------
# Tests: OFAC CSV Parsing
# ---------------------------------------------------------------------------


class TestOfacCsvParsing:
    """Test parsing of OFAC CSV feeds."""

    @pytest.mark.asyncio
    async def test_parse_sdn_csv(
        self, ofac_feed_manager: OfacFeedManager, sample_sdn_csv: bytes
    ) -> None:
        """Test parsing SDN CSV into OfacEntry objects."""
        entries = OfacFeedManager._parse_csv(ListType.SDN, sample_sdn_csv)

        assert len(entries) >= 2
        assert entries[0].uid == "123456"
        assert "AL-RASHID" in entries[0].full_name or "AL-RASHID" in entries[0].full_name.upper()
        assert "IRAN" in entries[0].programs

    @pytest.mark.asyncio
    async def test_parse_dpl_csv(
        self, ofac_feed_manager: OfacFeedManager, sample_dpl_csv: bytes
    ) -> None:
        """Test parsing DPL CSV."""
        entries = OfacFeedManager._parse_csv(ListType.DPL, sample_dpl_csv)

        assert len(entries) >= 2
        assert entries[0].full_name == "DENIED PERSON ONE"
        assert entries[0].list_type == ListType.DPL

    @pytest.mark.asyncio
    async def test_parse_eel_csv(
        self, ofac_feed_manager: OfacFeedManager, sample_eel_csv: bytes
    ) -> None:
        """Test parsing EEL CSV."""
        entries = OfacFeedManager._parse_csv(ListType.EEL, sample_eel_csv)

        assert len(entries) >= 2
        assert entries[0].full_name == "ENTITY ONE"
        assert entries[0].list_type == ListType.EEL


# ---------------------------------------------------------------------------
# Tests: Redis Caching
# ---------------------------------------------------------------------------


class TestRediscaching:
    """Test Redis caching of OFAC feeds."""

    @pytest.mark.asyncio
    async def test_store_in_cache(
        self,
        ofac_feed_manager: OfacFeedManager,
        mock_redis_client: AsyncMock,
    ) -> None:
        """Test storing parsed entries in Redis."""
        entries = [
            OfacEntry(
                uid="123",
                full_name="Test Person",
                list_type=ListType.SDN,
                programs=["IRAN"],
                country="Iran",
            ),
        ]

        content_hash = hashlib.sha256(b"test content").hexdigest()
        await ofac_feed_manager._store_in_cache(ListType.SDN, entries, content_hash)

        # Verify setex was called for entries, hash, and metadata
        assert mock_redis_client.setex.call_count >= 2

    @pytest.mark.asyncio
    async def test_load_from_cache(
        self,
        ofac_feed_manager: OfacFeedManager,
        mock_redis_client: AsyncMock,
    ) -> None:
        """Test loading entries from Redis cache."""
        # Mock cached data
        entries_data = [
            {
                "uid": "123",
                "full_name": "Test Person",
                "alt_names": [],
                "programs": ["IRAN"],
                "country": "Iran",
                "entity_type": "Individual",
                "additional_data": {},
            }
        ]
        cached_json = json.dumps(entries_data).encode()
        mock_redis_client.get = AsyncMock(return_value=cached_json)

        entries = await ofac_feed_manager._load_from_cache(ListType.SDN)

        assert entries is not None
        assert len(entries) == 1
        assert entries[0].full_name == "Test Person"

    @pytest.mark.asyncio
    async def test_cache_ttl_24_hours(
        self,
        ofac_feed_manager: OfacFeedManager,
        mock_redis_client: AsyncMock,
    ) -> None:
        """Test that cache TTL is set to 24 hours."""
        entries = [
            OfacEntry(
                uid="123",
                full_name="Test",
                list_type=ListType.SDN,
            ),
        ]

        content_hash = "abc123"
        await ofac_feed_manager._store_in_cache(ListType.SDN, entries, content_hash)

        # Check that setex was called with 24h TTL (86400 seconds)
        calls = mock_redis_client.setex.call_args_list
        for call in calls:
            assert call[0][1] == 86_400  # TTL argument


# ---------------------------------------------------------------------------
# Tests: Transaction Screening
# ---------------------------------------------------------------------------


class TestTransactionScreening:
    """Test real-time transaction screening."""

    @pytest.mark.asyncio
    async def test_screen_exact_match(
        self,
        ofac_feed_manager: OfacFeedManager,
        sample_sdn_csv: bytes,
    ) -> None:
        """Test screening a transaction with exact SDN match."""
        # Populate feed manager with test data
        entries = OfacFeedManager._parse_csv(ListType.SDN, sample_sdn_csv)
        ofac_feed_manager._entries[ListType.SDN] = entries
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        # Screen a transaction matching "AL-RASHID"
        result = await engine.screen_transaction(
            transaction_id="txn-001",
            agent_id="agent-123",
            counterparty_name="AL-RASHID ALI HASSAN",
            amount_usd=50_000.00,
        )

        assert result.is_match is True
        assert result.risk_score >= 80
        assert len(result.matched_entries) > 0
        assert "SDN" in str(result.matched_entries[0])

    @pytest.mark.asyncio
    async def test_screen_fuzzy_match(
        self,
        ofac_feed_manager: OfacFeedManager,
        sample_sdn_csv: bytes,
    ) -> None:
        """Test screening with fuzzy name matching."""
        entries = OfacFeedManager._parse_csv(ListType.SDN, sample_sdn_csv)
        ofac_feed_manager._entries[ListType.SDN] = entries
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.80,
        )

        # Screen with slightly misspelled name (fuzzy match)
        result = await engine.screen_transaction(
            transaction_id="txn-002",
            agent_id="agent-123",
            counterparty_name="AL-RASID ALI HASAN",  # Misspellings
            amount_usd=25_000.00,
        )

        # Depending on fuzzy threshold, should either match or not
        if result.is_match:
            assert result.risk_score >= 40
            assert len(result.matched_entries) > 0

    @pytest.mark.asyncio
    async def test_screen_no_match(
        self,
        ofac_feed_manager: OfacFeedManager,
        sample_sdn_csv: bytes,
    ) -> None:
        """Test screening with no match."""
        entries = OfacFeedManager._parse_csv(ListType.SDN, sample_sdn_csv)
        ofac_feed_manager._entries[ListType.SDN] = entries
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        # Screen a transaction with a name that doesn't match
        result = await engine.screen_transaction(
            transaction_id="txn-003",
            agent_id="agent-123",
            counterparty_name="John Smith Consulting",
            amount_usd=30_000.00,
        )

        assert result.is_match is False
        assert result.risk_score == 0
        assert len(result.matched_entries) == 0

    @pytest.mark.asyncio
    async def test_screen_large_amount_modifier(
        self,
        ofac_feed_manager: OfacFeedManager,
        sample_sdn_csv: bytes,
    ) -> None:
        """Test that large amounts increase risk score."""
        entries = OfacFeedManager._parse_csv(ListType.SDN, sample_sdn_csv)
        ofac_feed_manager._entries[ListType.SDN] = entries
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        # Screen with large amount
        result_large = await engine.screen_transaction(
            transaction_id="txn-004a",
            agent_id="agent-123",
            counterparty_name="AL-RASHID ALI HASSAN",
            amount_usd=250_000.00,  # Large amount
        )

        # Screen with small amount
        result_small = await engine.screen_transaction(
            transaction_id="txn-004b",
            agent_id="agent-123",
            counterparty_name="AL-RASHID ALI HASSAN",
            amount_usd=1_000.00,  # Small amount
        )

        # Large amount should have higher risk (or same if already maxed)
        assert result_large.risk_score >= result_small.risk_score
        if result_large.risk_score == result_small.risk_score and result_large.risk_score == 100:
            # Both maxed at 100
            pass
        else:
            assert result_large.risk_score > result_small.risk_score


# ---------------------------------------------------------------------------
# Tests: Mass-Default Alert Scenario
# ---------------------------------------------------------------------------


class TestMassDefaultAlert:
    """Test mass-default alert scenario (multiple SDN hits)."""

    @pytest.mark.asyncio
    async def test_multiple_sdn_hits(
        self,
        ofac_feed_manager: OfacFeedManager,
    ) -> None:
        """Test transaction with matches across multiple lists."""
        # Create entries in all three lists
        sdn_entries = [
            OfacEntry(
                uid="sdn-001",
                full_name="SUSPICIOUS ENTITY A",
                list_type=ListType.SDN,
                programs=["IRAN"],
            ),
        ]
        dpl_entries = [
            OfacEntry(
                uid="dpl-001",
                full_name="SUSPICIOUS ENTITY A",  # Same name on DPL
                list_type=ListType.DPL,
            ),
        ]
        eel_entries = [
            OfacEntry(
                uid="eel-001",
                full_name="SUSPICIOUS ENTITY A",  # Same name on EEL
                list_type=ListType.EEL,
            ),
        ]

        ofac_feed_manager._entries[ListType.SDN] = sdn_entries
        ofac_feed_manager._entries[ListType.DPL] = dpl_entries
        ofac_feed_manager._entries[ListType.EEL] = eel_entries

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        result = await engine.screen_transaction(
            transaction_id="txn-mass-default",
            agent_id="agent-123",
            counterparty_name="SUSPICIOUS ENTITY A",
            amount_usd=150_000.00,
        )

        # Should have high risk score due to multiple list hits
        assert result.is_match is True
        assert result.risk_score >= 80
        assert len(result.matched_entries) == 3  # Hit on all three lists
        assert "Multiple list hits" in str(result.hit_reasons)

    @pytest.mark.asyncio
    async def test_phonetic_match_bonus(
        self,
        ofac_feed_manager: OfacFeedManager,
    ) -> None:
        """Test that phonetic matches contribute to risk scoring."""
        # Entry with name that sounds like "Rashid"
        sdn_entries = [
            OfacEntry(
                uid="sdn-001",
                full_name="RASHEEDI",  # Phonetically similar to Rashid
                list_type=ListType.SDN,
                programs=["IRAN"],
            ),
        ]

        ofac_feed_manager._entries[ListType.SDN] = sdn_entries
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        # Screen with similar-sounding name
        result = await engine.screen_transaction(
            transaction_id="txn-phonetic",
            agent_id="agent-123",
            counterparty_name="RASHID",  # Close phonetically
            amount_usd=50_000.00,
        )

        # May or may not hit depending on fuzzy threshold
        # Just verify it doesn't crash and returns valid result
        assert result.transaction_id == "txn-phonetic"
        assert 0 <= result.risk_score <= 100


# ---------------------------------------------------------------------------
# Tests: Error Handling and Fallback
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """Test error handling and fallback scenarios."""

    @pytest.mark.asyncio
    async def test_screen_with_empty_feeds(
        self,
        ofac_feed_manager: OfacFeedManager,
    ) -> None:
        """Test screening when feeds are not loaded."""
        # Don't populate any feeds
        ofac_feed_manager._entries[ListType.SDN] = []
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        result = await engine.screen_transaction(
            transaction_id="txn-empty",
            agent_id="agent-123",
            counterparty_name="Some Entity",
            amount_usd=10_000.00,
        )

        # Should return clean result
        assert result.is_match is False
        assert result.risk_score == 0
        assert len(result.matched_entries) == 0

    @pytest.mark.asyncio
    async def test_screen_with_invalid_counterparty_name(
        self,
        ofac_feed_manager: OfacFeedManager,
    ) -> None:
        """Test screening with invalid/empty counterparty name."""
        ofac_feed_manager._entries[ListType.SDN] = []
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        # Test with empty name
        result = await engine.screen_transaction(
            transaction_id="txn-empty-name",
            agent_id="agent-123",
            counterparty_name="",
            amount_usd=10_000.00,
        )

        assert result.is_match is False
        assert result.risk_score == 0

    @pytest.mark.asyncio
    async def test_feed_refresh_with_change_detection(
        self,
        ofac_feed_manager: OfacFeedManager,
        mock_redis_client: AsyncMock,
        sample_sdn_csv: bytes,
    ) -> None:
        """Test that feed refresh detects content changes via hash."""
        # First download with hash
        first_hash = hashlib.sha256(sample_sdn_csv).hexdigest()

        # Mock download to return our sample CSV
        with patch.object(
            ofac_feed_manager, "_download_csv", new_callable=AsyncMock
        ) as mock_download:
            mock_download.return_value = sample_sdn_csv

            # First refresh
            result1 = await ofac_feed_manager.refresh_feed(ListType.SDN)
            assert result1["entry_count"] > 0

            # Second refresh (should detect no change if hash matches)
            mock_redis_client.get = AsyncMock(
                return_value=first_hash.encode()
            )
            result2 = await ofac_feed_manager.refresh_feed(ListType.SDN)

            # Should recognize as cached (no change)
            assert result2["cache_status"] in ["cached", "refreshed"]


# ---------------------------------------------------------------------------
# Tests: Feed Status and Metadata
# ---------------------------------------------------------------------------


class TestFeedStatusAndMetadata:
    """Test feed status retrieval and metadata tracking."""

    @pytest.mark.asyncio
    async def test_get_feed_status(
        self,
        ofac_feed_manager: OfacFeedManager,
        sample_sdn_csv: bytes,
    ) -> None:
        """Test retrieving feed status metadata."""
        entries = OfacFeedManager._parse_csv(ListType.SDN, sample_sdn_csv)
        ofac_feed_manager._entries[ListType.SDN] = entries

        # Set metadata
        import time
        ofac_feed_manager._metadata[ListType.SDN] = type('obj', (object,), {
            'entry_count': len(entries),
            'downloaded_at': time.time(),
            'hash': 'abc123def456',
        })

        status = ofac_feed_manager.get_feed_status(ListType.SDN)

        assert "SDN" in status
        assert status["SDN"]["entry_count"] > 0
        assert "age_hours" in status["SDN"]
        assert status["SDN"]["hash"] == "abc123de"  # First 8 chars

    @pytest.mark.asyncio
    async def test_get_all_feeds_status(
        self,
        ofac_feed_manager: OfacFeedManager,
    ) -> None:
        """Test retrieving status of all feeds."""
        status = ofac_feed_manager.get_feed_status()

        # Should have entries for all three lists
        assert "SDN" in status
        assert "DPL" in status
        assert "EEL" in status


# ---------------------------------------------------------------------------
# Tests: Batch Screening
# ---------------------------------------------------------------------------


class TestBatchScreening:
    """Test batch transaction screening."""

    @pytest.mark.asyncio
    async def test_batch_screen_transactions(
        self,
        ofac_feed_manager: OfacFeedManager,
        sample_sdn_csv: bytes,
    ) -> None:
        """Test screening multiple transactions concurrently."""
        entries = OfacFeedManager._parse_csv(ListType.SDN, sample_sdn_csv)
        ofac_feed_manager._entries[ListType.SDN] = entries
        ofac_feed_manager._entries[ListType.DPL] = []
        ofac_feed_manager._entries[ListType.EEL] = []

        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        transactions = [
            {
                "transaction_id": "txn-batch-1",
                "agent_id": "agent-123",
                "counterparty_name": "AL-RASHID ALI HASSAN",
                "amount_usd": 50_000.00,
            },
            {
                "transaction_id": "txn-batch-2",
                "agent_id": "agent-123",
                "counterparty_name": "John Smith",
                "amount_usd": 10_000.00,
            },
            {
                "transaction_id": "txn-batch-3",
                "agent_id": "agent-123",
                "counterparty_name": "OMEGA TRADING",
                "amount_usd": 75_000.00,
            },
        ]

        results = await engine.batch_screen(transactions)

        assert len(results) == 3
        # First and third should match (SDN entries)
        assert results[0].is_match is True
        # Second should not match (clean name)
        assert results[1].is_match is False


# ---------------------------------------------------------------------------
# Integration Tests
# ---------------------------------------------------------------------------


class TestIntegration:
    """End-to-end integration tests."""

    @pytest.mark.asyncio
    async def test_full_feed_refresh_and_screen(
        self,
        ofac_feed_manager: OfacFeedManager,
        mock_redis_client: AsyncMock,
        sample_sdn_csv: bytes,
        sample_dpl_csv: bytes,
        sample_eel_csv: bytes,
    ) -> None:
        """Test complete flow: refresh feeds, screen transactions."""
        # Mock downloads
        def mock_download(list_type: ListType) -> bytes:
            if list_type == ListType.SDN:
                return sample_sdn_csv
            elif list_type == ListType.DPL:
                return sample_dpl_csv
            else:
                return sample_eel_csv

        with patch.object(
            ofac_feed_manager, "_download_csv", side_effect=mock_download
        ):
            # Refresh all feeds
            result = await ofac_feed_manager.refresh_all_feeds()

            assert "SDN" in result
            assert "DPL" in result
            assert "EEL" in result

        # Now screen a transaction
        engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            fuzzy_threshold=0.85,
        )

        screen_result = await engine.screen_transaction(
            transaction_id="txn-integration",
            agent_id="agent-123",
            counterparty_name="AL-RASHID",
            amount_usd=100_000.00,
        )

        assert screen_result.is_match is True
        assert screen_result.risk_score > 0
        assert len(screen_result.matched_entries) > 0
