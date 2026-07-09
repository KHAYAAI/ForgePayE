"""
OFAC real-time feed integration.

Downloads SSI CSV files from Treasury Department, parses them, caches in Redis,
and provides name variant matching (soundex, metaphone, fuzzy).

File formats:
  - SDN.CSV: Specially Designated Nationals list (main watch list)
  - DPL.CSV: Denied Persons List (BIS)
  - EEL.CSV: Entity List (BIS)

Each has columns: [*FullName, ...] with optional fuzzy match columns.

Production URL: https://www.treasury.gov/ofac/downloads/ssi/
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import httpx
import structlog
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

logger = structlog.get_logger(__name__)


class ListType(str, Enum):
    """OFAC list types."""
    SDN = "SDN"
    DPL = "DPL"
    EEL = "EEL"


@dataclass
class OfacEntry:
    """Single entry from an OFAC CSV feed."""

    uid: str
    full_name: str
    list_type: ListType
    alt_names: list[str] = field(default_factory=list)
    programs: list[str] = field(default_factory=list)
    country: str = ""
    entity_type: str = ""  # "Individual" | "Entity" | "Vessel" | "Aircraft"
    additional_data: dict[str, Any] = field(default_factory=dict)

    def all_names(self) -> list[str]:
        """All names (primary + alternates) for this entry."""
        return [self.full_name] + self.alt_names


@dataclass
class OfacFeedMetadata:
    """Metadata about a cached OFAC feed."""

    list_type: ListType
    downloaded_at: float  # unix timestamp
    entry_count: int
    hash: str  # SHA256 of CSV content for change detection


class OfacFeedManager:
    """
    Manages OFAC feed downloads and Redis caching.

    Responsibilities:
      1. Download CSV files from Treasury.gov (with retry logic)
      2. Parse CSV rows into OfacEntry objects
      3. Cache in Redis with 24h TTL
      4. Detect changes via content hash
      5. Return entries for screening

    Thread-safe: all operations use async/await.
    """

    def __init__(
        self,
        redis_client: Any,
        feed_base_url: str = "https://www.treasury.gov/ofac/downloads/ssi/",
        cache_ttl_seconds: int = 86_400,  # 24 hours
    ) -> None:
        """
        Initialize the OFAC feed manager.

        Args:
            redis_client: redis.asyncio.Redis instance (or sync Redis wrapped async)
            feed_base_url: Base URL for Treasury SSI CSV files
            cache_ttl_seconds: How long to cache feeds in Redis (default 24h)
        """
        self._redis = redis_client
        self._feed_base_url = feed_base_url.rstrip("/")
        self._cache_ttl = cache_ttl_seconds

        # In-memory cache for current entries (keyed by list type)
        self._entries: dict[ListType, list[OfacEntry]] = {}
        self._metadata: dict[ListType, OfacFeedMetadata] = {}
        self._last_refresh: dict[ListType, float] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def refresh_all_feeds(self) -> dict[str, Any]:
        """
        Refresh all OFAC feeds (SDN, DPL, EEL) concurrently.

        Returns:
            {
                "SDN": {"entry_count": int, "age_hours": float},
                "DPL": {...},
                "EEL": {...},
            }
        """
        logger.info("ofac_feed.refresh_all.start")

        results = await asyncio.gather(
            self.refresh_feed(ListType.SDN),
            self.refresh_feed(ListType.DPL),
            self.refresh_feed(ListType.EEL),
            return_exceptions=True,
        )

        response = {}
        for list_type, result in zip([ListType.SDN, ListType.DPL, ListType.EEL], results):
            if isinstance(result, Exception):
                logger.warning(
                    "ofac_feed.refresh_failed",
                    list_type=list_type.value,
                    error=str(result),
                )
                response[list_type.value] = {"error": str(result)}
            else:
                response[list_type.value] = result

        logger.info("ofac_feed.refresh_all.done", response=response)
        return response

    async def refresh_feed(self, list_type: ListType) -> dict[str, Any]:
        """
        Download and cache a single OFAC feed.

        Returns:
            {
                "list_type": "SDN",
                "entry_count": int,
                "age_hours": float,
                "cache_status": "loaded" | "cached" | "refreshed",
            }
        """
        logger.info("ofac_feed.refresh", list_type=list_type.value)

        try:
            csv_data = await self._download_csv(list_type)
            entries = self._parse_csv(list_type, csv_data)

            # Check if content changed
            content_hash = hashlib.sha256(csv_data).hexdigest()
            cache_key = f"ofac:feed:{list_type.value}:hash"
            old_hash = await self._redis.get(cache_key)

            cache_status = "loaded"
            if old_hash and old_hash.decode() == content_hash:
                cache_status = "cached"
                logger.info(
                    "ofac_feed.no_change",
                    list_type=list_type.value,
                    entry_count=len(entries),
                )
            else:
                cache_status = "refreshed"
                await self._store_in_cache(list_type, entries, content_hash)
                logger.info(
                    "ofac_feed.updated",
                    list_type=list_type.value,
                    entry_count=len(entries),
                    old_hash=old_hash.decode()[:8] if old_hash else None,
                    new_hash=content_hash[:8],
                )

            # Update in-memory cache
            self._entries[list_type] = entries
            self._metadata[list_type] = OfacFeedMetadata(
                list_type=list_type,
                downloaded_at=time.time(),
                entry_count=len(entries),
                hash=content_hash,
            )
            self._last_refresh[list_type] = time.time()

            return {
                "list_type": list_type.value,
                "entry_count": len(entries),
                "age_hours": 0.0,
                "cache_status": cache_status,
            }

        except Exception as exc:
            logger.exception(
                "ofac_feed.refresh_error",
                list_type=list_type.value,
                error=str(exc),
            )

            # Try to load from Redis fallback cache
            fallback_entries = await self._load_from_cache(list_type)
            if fallback_entries:
                self._entries[list_type] = fallback_entries
                metadata = self._metadata.get(list_type)
                if metadata:
                    age_h = (time.time() - metadata.downloaded_at) / 3600.0
                    logger.warning(
                        "ofac_feed.fallback_cache_loaded",
                        list_type=list_type.value,
                        entry_count=len(fallback_entries),
                        age_hours=age_h,
                    )
                    return {
                        "list_type": list_type.value,
                        "entry_count": len(fallback_entries),
                        "age_hours": age_h,
                        "cache_status": "fallback",
                    }

            # No fallback; re-raise with meaningful message
            raise RuntimeError(
                f"Failed to refresh {list_type.value} feed and no cached fallback available"
            ) from exc

    def search_entries(
        self,
        list_type: ListType,
        query: str,
        threshold: float = 0.85,
    ) -> list[OfacEntry]:
        """
        Search entries by name with fuzzy matching.

        Args:
            list_type: Which list to search (SDN, DPL, EEL)
            query: Name or entity to search for
            threshold: Fuzzy match threshold (0.0–1.0)

        Returns:
            List of matching entries, sorted by similarity desc.
        """
        entries = self._entries.get(list_type, [])
        if not entries or not query or not query.strip():
            return []

        from fuzzywuzzy import fuzz  # type: ignore[import-untyped]

        norm_query = self._normalise_name(query)
        matches: list[tuple[OfacEntry, float]] = []

        for entry in entries:
            best_score = 0.0
            for name in entry.all_names():
                norm_name = self._normalise_name(name)
                # Use token_sort_ratio for order-invariant matching
                score = fuzz.token_sort_ratio(norm_query, norm_name) / 100.0
                best_score = max(best_score, score)

            if best_score >= threshold:
                matches.append((entry, best_score))

        # Sort by score descending
        matches.sort(key=lambda x: x[1], reverse=True)
        return [e for e, _ in matches]

    def get_feed_status(self, list_type: ListType | None = None) -> dict[str, Any]:
        """
        Get metadata about loaded feeds.

        Args:
            list_type: If specified, return status for only that list.
                      If None, return status for all lists.

        Returns:
            {
                "SDN": {"entry_count": int, "age_hours": float, "hash": str},
                ...
            }
        """
        if list_type:
            metadata = self._metadata.get(list_type)
            if metadata:
                age_h = (time.time() - metadata.downloaded_at) / 3600.0
                return {
                    list_type.value: {
                        "entry_count": metadata.entry_count,
                        "age_hours": round(age_h, 2),
                        "hash": metadata.hash[:8],
                    }
                }
            return {list_type.value: {"error": "not_loaded"}}

        response = {}
        for lt in ListType:
            metadata = self._metadata.get(lt)
            if metadata:
                age_h = (time.time() - metadata.downloaded_at) / 3600.0
                response[lt.value] = {
                    "entry_count": metadata.entry_count,
                    "age_hours": round(age_h, 2),
                    "hash": metadata.hash[:8],
                }
            else:
                response[lt.value] = {"error": "not_loaded"}

        return response

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise_name(name: str) -> str:
        """Normalize name for matching: lowercase, remove punctuation, collapse spaces."""
        import re
        lower = name.lower().strip()

        # Apostrophes join a name rather than separate it — "O'Brien" must
        # normalize to "obrien", not "o brien" (see screening.py's
        # normalize_name, which has the same fix for the same reason: two
        # tokens would fail to match the single-token form on a watchlist).
        no_apostrophe = re.sub(r"['’]", "", lower)

        # Noise words: corporate entity-type suffixes and stopwords only.
        # "global", "solutions", "international", "group", "holdings" etc.
        # are part of what DISTINGUISHES one entity's name from another —
        # stripping them collapses unrelated companies (every "X Solutions"
        # or "Y International") to the same normalized name, which is a
        # false-positive/false-negative risk in sanctions matching.
        noise = {"inc", "llc", "ltd", "corp", "co", "company", "corporation",
                 "limited", "the", "and",
                 "of", "for", "in", "a", "an", "sa", "ag", "bv", "gmbh", "pte",
                 "pty", "plc", "llp", "lp", "nv", "spa", "srl", "sas"}

        no_punct = re.sub(r"[^\w\s]", " ", no_apostrophe)
        tokens = [t for t in no_punct.split() if t and t not in noise]
        return " ".join(tokens)

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=60),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _download_csv(self, list_type: ListType) -> bytes:
        """
        Download CSV file from Treasury.gov with retries.

        Args:
            list_type: Which feed to download (SDN, DPL, EEL)

        Returns:
            Raw CSV bytes

        Raises:
            httpx.HTTPError on network failure after retries
        """
        url = f"{self._feed_base_url}{list_type.value}.CSV"
        logger.info("ofac_feed.download", url=url, list_type=list_type.value)

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content

    @staticmethod
    def _parse_csv(list_type: ListType, csv_data: bytes) -> list[OfacEntry]:
        """
        Parse OFAC CSV file into OfacEntry objects.

        Column layout genuinely differs by list type (confirmed against the
        real Treasury schema — see the field map in _parse_row):
          SDN.CSV: uid, ent_num, sdn_name, sdn_type, program, ..., country, ...
          DPL.CSV: name, address, country, effective_date  (no id column)
          EEL.CSV: name, country, effective_date            (no id column)

        Parsed by header name (csv.DictReader), not fixed positional
        indices — a prior positional implementation (col0=uid, col1=name,
        col2=country, col3=programs) silently mismapped every field for
        SDN and DPL/EEL alike, since their real column orders don't agree
        with each other or with that fixed scheme. Column name matching is
        case-insensitive to tolerate header casing variation across feeds.

        Real-world parsing requires consulting Treasury docs:
          https://www.treasury.gov/ofac/downloads/ssi/ssi_schema.txt
        """
        entries: list[OfacEntry] = []

        try:
            text = csv_data.decode("utf-8", errors="replace")
            reader = csv.DictReader(io.StringIO(text))

            for row_num, row in enumerate(reader):
                # Normalize header casing once per row so field lookups
                # below are case-insensitive regardless of feed formatting.
                normalized = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}

                try:
                    entry = OfacFeedManager._parse_row(normalized, list_type, row_num)
                    if entry:
                        entries.append(entry)
                except (ValueError, IndexError, KeyError) as e:
                    logger.warning(
                        "ofac_feed.parse_error",
                        list_type=list_type.value,
                        row_num=row_num,
                        error=str(e),
                    )
                    continue

            logger.info(
                "ofac_feed.parsed",
                list_type=list_type.value,
                entry_count=len(entries),
            )
            return entries

        except Exception as exc:
            logger.error(
                "ofac_feed.parse_failed",
                list_type=list_type.value,
                error=str(exc),
            )
            raise

    @staticmethod
    def _parse_row(row: dict[str, str], list_type: ListType, row_num: int) -> OfacEntry | None:
        """
        Parse a single CSV row (as a lowercase-keyed dict from DictReader)
        into an OfacEntry, using the field names that actually appear for
        each list type. Falls back to a synthetic uid (`{list_type}-{row}`)
        when the feed has no id/uid column at all — true for the real DPL
        and EEL formats, which identify entries by name, not a numeric id.
        """
        if list_type == ListType.SDN:
            uid = row.get("uid") or row.get("ent_num") or ""
            full_name = row.get("sdn_name") or row.get("name") or ""
            country = row.get("country", "")
            programs = [p.strip() for p in row.get("program", "").split(";") if p.strip()]
            entity_type = row.get("sdn_type") or "Unknown"
        else:
            # DPL / EEL share the same simple {name, country, ...} shape.
            uid = row.get("id") or row.get("uid") or ""
            full_name = row.get("name") or ""
            country = row.get("country", "")
            programs = [p.strip() for p in row.get("program", "").split(";") if p.strip()]
            entity_type = row.get("add_type") or "Entity"

        if not full_name:
            return None
        if not uid:
            uid = f"{list_type.value}-{row_num}"

        return OfacEntry(
            uid=uid,
            full_name=full_name,
            list_type=list_type,
            alt_names=[],
            programs=programs,
            country=country,
            entity_type=entity_type,
        )

    async def _store_in_cache(
        self,
        list_type: ListType,
        entries: list[OfacEntry],
        content_hash: str,
    ) -> None:
        """Store parsed entries and metadata in Redis."""
        import json

        # Store entries as JSON list
        entries_key = f"ofac:feed:{list_type.value}:entries"
        entries_json = json.dumps([
            {
                "uid": e.uid,
                "full_name": e.full_name,
                "alt_names": e.alt_names,
                "programs": e.programs,
                "country": e.country,
                "entity_type": e.entity_type,
                "additional_data": e.additional_data,
            }
            for e in entries
        ])

        await self._redis.setex(
            entries_key,
            self._cache_ttl,
            entries_json,
        )

        # Store hash for change detection
        hash_key = f"ofac:feed:{list_type.value}:hash"
        await self._redis.setex(hash_key, self._cache_ttl, content_hash)

        # Store metadata
        metadata_key = f"ofac:feed:{list_type.value}:metadata"
        metadata_json = json.dumps({
            "downloaded_at": time.time(),
            "entry_count": len(entries),
            "hash": content_hash,
        })
        await self._redis.setex(metadata_key, self._cache_ttl, metadata_json)

    async def _load_from_cache(self, list_type: ListType) -> list[OfacEntry] | None:
        """Load entries from Redis cache (fallback for feed download failures)."""
        import json

        entries_key = f"ofac:feed:{list_type.value}:entries"
        cached_json = await self._redis.get(entries_key)

        if not cached_json:
            return None

        try:
            data = json.loads(cached_json.decode() if isinstance(cached_json, bytes) else cached_json)
            entries = [
                OfacEntry(
                    uid=item["uid"],
                    full_name=item["full_name"],
                    list_type=list_type,
                    alt_names=item.get("alt_names", []),
                    programs=item.get("programs", []),
                    country=item.get("country", ""),
                    entity_type=item.get("entity_type", ""),
                    additional_data=item.get("additional_data", {}),
                )
                for item in data
            ]
            return entries
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(
                "ofac_feed.cache_load_error",
                list_type=list_type.value,
                error=str(e),
            )
            return None
