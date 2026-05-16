# OFAC Real-Time Feed Integration

## Overview

The compliance-monitor service now includes a complete OFAC (Office of Foreign Assets Control) real-time feed integration for sanctions screening and transaction monitoring.

**Key Features:**
- Real-time screening against OFAC SDN, BIS DPL, and BIS EEL lists
- Multiple name matching algorithms (fuzzy, soundex, metaphone)
- Redis-backed 24-hour caching with fallback on feed unavailability
- APScheduler-driven daily feed refresh at UTC midnight
- Risk scoring with phonetic variant detection
- Mass-default alert detection (multi-list hits)
- Comprehensive audit logging integration
- Helm configuration for production deployment

## Architecture

### Components

1. **OfacFeedManager** (`src/ofac/feed.py`)
   - Downloads CSV files from Treasury.gov with retry logic
   - Parses SDN.CSV, DPL.CSV, EEL.CSV into OfacEntry objects
   - Caches parsed entries in Redis with 24-hour TTL
   - Detects content changes via SHA256 hashing
   - Implements fallback to cached lists on download failure

2. **TransactionScreeningEngine** (`src/sanctions/screening.py`)
   - Screens transactions in real-time against all three lists
   - Uses multi-algorithm name matching (fuzzy, soundex, metaphone)
   - Computes composite risk scores (0–100)
   - Logs results to audit service
   - Supports batch screening with concurrent processing

3. **Name Matching Algorithms**
   - **Fuzzy Matching**: token_sort_ratio from fuzzywuzzy (handles order variance)
   - **Soundex**: Phonetic encoding for similar-sounding names
   - **Metaphone**: English pronunciation variants
   - **Normalization**: Strips company suffixes (Inc, LLC, Ltd), removes punctuation

4. **Routers** (`src/routers/ofac_screening.py`)
   - `POST /v1/screening` — Screen single transaction
   - `POST /v1/screening/batch` — Screen multiple transactions
   - `GET /v1/sanctions/ofac/status` — Feed status and metrics
   - `POST /v1/sanctions/refresh` — Manual feed refresh trigger

### Data Flow

```
Treasury.gov (SDN.CSV, DPL.CSV, EEL.CSV)
         ↓
  [OfacFeedManager]
      /  |  \
     /   |   \
  Redis  Parse  In-Memory Cache
    |      |      |
    └──────┴──────┘
          ↓
[TransactionScreeningEngine]
      |
      ├→ Fuzzy match against names
      ├→ Soundex/Metaphone phonetic matching
      ├→ Risk scoring
      └→ Audit logging
          ↓
    Client Response + Audit Log
```

## Configuration

### Environment Variables

```bash
# OFAC Feed URLs
OFAC_FEED_URL=https://www.treasury.gov/ofac/downloads/ssi/  # CSV feeds
OFAC_SDN_URL=https://www.treasury.gov/ofac/downloads/sdn.xml  # XML fallback
OFAC_CACHE_TTL=86400  # 24 hours

# Refresh schedules (APScheduler cron format)
OFAC_REFRESH_CRON=0 2 * * *   # Daily at 02:00 UTC (after XML refresh)

# Fuzzy matching sensitivity
FUZZY_MATCH_THRESHOLD=0.85    # 0.0–1.0 (lower = more matches)

# Redis backend
REDIS_URL=redis://localhost:6379/2

# Audit service
AUDIT_SERVICE_URL=http://bank-whitelabel:8005
```

### Helm Configuration

See `forgepay/infra/helm/compliance-monitor/values.yaml` for complete Helm chart values including:
- Resource limits and requests
- Health check configuration
- Autoscaling policies
- Redis cache settings
- Ingress configuration
- Security context

## API Reference

### POST /v1/screening — Screen Single Transaction

**Request:**
```json
{
  "transaction_id": "txn-2026-05-16-001",
  "agent_id": "agent-acme-corp",
  "counterparty_name": "Acme Trading Inc",
  "amount_usd": 50000.00
}
```

**Response:**
```json
{
  "transaction_id": "txn-2026-05-16-001",
  "agent_id": "agent-acme-corp",
  "counterparty_name": "Acme Trading Inc",
  "amount_usd": 50000.00,
  "risk_score": 85,
  "is_match": true,
  "matched_entries": [
    {
      "list_type": "SDN",
      "uid": "12345",
      "full_name": "ACME TRADING LLC",
      "match_method": "fuzzy",
      "fuzzy_score": 0.9612
    }
  ],
  "hit_reasons": [
    "SDN fuzzy match: ACME TRADING LLC (0.96%)",
    "Large transaction: $50,000.00 USD"
  ],
  "screened_at": "2026-05-16T12:34:56.789123Z",
  "recommended_action": "review"
}
```

### POST /v1/screening/batch — Screen Multiple Transactions

**Request:**
```json
{
  "transactions": [
    {
      "transaction_id": "txn-001",
      "agent_id": "agent-xyz",
      "counterparty_name": "Acme Trading",
      "amount_usd": 25000.00
    },
    {
      "transaction_id": "txn-002",
      "agent_id": "agent-xyz",
      "counterparty_name": "Johns Smith Consulting",
      "amount_usd": 10000.00
    }
  ]
}
```

**Response:** Array of screening result objects (same structure as single screening)

### GET /v1/sanctions/ofac/status — Get Feed Status

**Response:**
```json
{
  "last_refresh": "2026-05-16T12:34:56.789123Z",
  "feeds": {
    "SDN": {
      "entry_count": 12345,
      "age_hours": 2.5,
      "hash": "abc123de"
    },
    "DPL": {
      "entry_count": 3456,
      "age_hours": 2.5,
      "hash": "def456ab"
    },
    "EEL": {
      "entry_count": 6789,
      "age_hours": 2.5,
      "hash": "ghi789cd"
    }
  },
  "source": "csv_feeds"
}
```

### POST /v1/sanctions/refresh — Manually Refresh Feeds

**Response:**
```json
{
  "status": "success",
  "SDN": {
    "entry_count": 12345,
    "age_hours": 0.1,
    "cache_status": "refreshed"
  },
  "DPL": {
    "entry_count": 3456,
    "age_hours": 0.1,
    "cache_status": "refreshed"
  },
  "EEL": {
    "entry_count": 6789,
    "age_hours": 0.1,
    "cache_status": "refreshed"
  }
}
```

## Risk Scoring Logic

Risk scores are computed on a 0–100 scale based on:

| Event | Score |
|-------|-------|
| SDN exact match (≥0.98 similarity) | +95 |
| SDN fuzzy match (0.85–0.98 similarity) | +85 |
| SDN phonetic match (soundex/metaphone) | +50 |
| DPL (BIS Denied Persons List) match | +75 |
| EEL (BIS Entity List) match | +60 |
| Large transaction (>$100k USD) | +10 |
| Multiple list hits (2+ lists) | +10 |

**Capped at 100; recommended actions:**
- **0–39**: Allow (low risk)
- **40–79**: Review (medium risk)
- **80–100**: Block (high risk)

## Name Matching Examples

### Fuzzy Matching
```
Query: "ACME TRADING INC"
List:  "ACME TRADE LIMITED"
Match: Yes (token_sort_ratio ≈ 0.87)
```

### Soundex Matching
```
Query: "Smith"      (Soundex: S530)
List:  "Smythe"     (Soundex: S530)
Match: Yes (phonetic variant)
```

### Metaphone Matching
```
Query: "Phillips"   (Metaphone codes similar)
List:  "Philips"    (Missing second 'l')
Match: Yes (pronunciation variant)
```

### Noise Word Stripping
```
Query: "Global Solutions LLC"   → normalized: "global solutions"
List:  "GLOBAL SOLUTIONS CORP"  → normalized: "global solutions"
Match: Yes (100% after normalization)
```

## Scheduler Jobs

The service automatically runs these scheduled jobs:

| Job | Trigger | Time | Action |
|-----|---------|------|--------|
| OFAC SDN List Refresh | Daily cron | 02:00 UTC | Fetch SDN.XML |
| EU Sanctions Refresh | Daily cron | 03:00 UTC | Fetch EU list |
| OFAC CSV Feeds Refresh | Daily cron | 02:30 UTC | Fetch SDN/DPL/EEL CSV |
| Transaction Monitoring | Every 5 min | * | Run AML rules |

## Error Handling

### Feed Download Failure

If Treasury.gov is unreachable:
1. Service logs warning
2. Attempts to load from Redis fallback cache
3. If cache exists (< 24h old), uses cached data with `cache_status: "fallback"`
4. If no cache, returns 503 Service Unavailable
5. Retries with exponential backoff (1–60 seconds)

### Invalid CSV Content

- Malformed rows are skipped with a warning
- Service continues processing valid rows
- Entry count reflects only successfully parsed entries

### Redis Connection Failure

- OFAC feed manager is initialized but disabled
- Screening still works against in-memory XML lists
- CSV feeds are not cached (higher latency on each refresh)

## Testing

Comprehensive test suite in `tests/test_ofac_feed_integration.py`:

```bash
# Run all OFAC tests
pytest tests/test_ofac_feed_integration.py -v

# Run specific test class
pytest tests/test_ofac_feed_integration.py::TestNameMatchingAlgorithms -v

# Run with coverage
pytest tests/test_ofac_feed_integration.py --cov=src.sanctions --cov=src.ofac -v
```

### Test Coverage

**Test Classes:**
1. `TestNameMatchingAlgorithms` — Phonetic/fuzzy matching (5 tests)
2. `TestOfacCsvParsing` — CSV parsing for SDN/DPL/EEL (3 tests)
3. `TestRediscaching` — Cache storage/retrieval/TTL (3 tests)
4. `TestTransactionScreening` — Real-time screening (5 tests)
5. `TestMassDefaultAlert` — Multi-list hit detection (2 tests)
6. `TestErrorHandling` — Failure scenarios (3 tests)
7. `TestFeedStatusAndMetadata` — Metadata tracking (2 tests)
8. `TestBatchScreening` — Concurrent processing (1 test)
9. `TestIntegration` — End-to-end flow (1 test)

**Total: 10+ comprehensive test cases**

## Deployment

### Docker

```bash
docker build -t forgepay/compliance-monitor:0.1.0 .
docker run -e REDIS_URL=redis://redis:6379/2 \
           -e OFAC_FEED_URL=https://www.treasury.gov/ofac/downloads/ssi/ \
           -p 8003:8003 \
           forgepay/compliance-monitor:0.1.0
```

### Kubernetes with Helm

```bash
helm install compliance-monitor ./infra/helm/compliance-monitor/ \
  --namespace compliance \
  --values values-prod.yaml
```

### Environment Setup Checklist

- [ ] Redis cache running (6379)
- [ ] OFAC_FEED_URL points to Treasury.gov
- [ ] OFAC_CACHE_TTL set to 86400 (24h)
- [ ] Audit service available at AUDIT_SERVICE_URL
- [ ] JWT_SECRET configured for auth
- [ ] CORS_ORIGINS set for dashboard
- [ ] High-risk countries list configured
- [ ] Health endpoints (`/health`, `/readyz`) responding

## Performance Characteristics

- **Single transaction screening**: ~10–50 ms
- **Batch screening (100 txns)**: ~500–1000 ms (concurrent)
- **OFAC list size**: ~12k SDN, ~3k DPL, ~7k EEL entries
- **Memory footprint**: ~200–300 MB (in-memory + Redis)
- **Cache hit rate**: >95% (Redis)
- **Feed refresh time**: ~5–30 seconds

## Security Considerations

1. **PCI Compliance**: No card data is handled; names only
2. **API Authentication**: All endpoints require JWT or API key
3. **Audit Logging**: All screening results logged to audit service
4. **Cache Security**: Redis data unencrypted at rest (use Redis Cluster with TLS in production)
5. **Network**: Use mutual TLS (mTLS) for service-to-service communication

## Future Enhancements

- [ ] UN Consolidated Sanctions List integration
- [ ] FBI Most Wanted integration
- [ ] Watchlists from additional jurisdictions (UK, Canada, etc.)
- [ ] Machine learning-based name variant detection
- [ ] Real-time webhook from Treasury.gov on list updates
- [ ] Transaction history correlation (repeat offender detection)
- [ ] Geographic high-risk indicator scoring

## Troubleshooting

### High False Positive Rate
→ Increase `FUZZY_MATCH_THRESHOLD` (e.g., 0.90 instead of 0.85)

### Missing OFAC Matches
→ Check feed status with `GET /v1/sanctions/ofac/status`
→ Verify entry names in CSV (may use different format than query)

### Slow Screening Performance
→ Verify Redis connection with `redis-cli ping`
→ Check feed entry counts (if >20k entries, consider filtering)

### Feed Refresh Failures
→ Check Treasury.gov availability (may be offline)
→ Verify internet connectivity and proxy settings
→ Check Redis cache fallback: `GET /health` should show age_hours

## References

- **OFAC SDN Schema**: https://home.treasury.gov/system/files/126/sdn_advanced_notes.pdf
- **Treasury SSI Downloads**: https://www.treasury.gov/ofac/downloads/
- **BIS Entity List**: https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/entity-list
- **Soundex Algorithm**: https://en.wikipedia.org/wiki/Soundex
- **Metaphone Algorithm**: https://en.wikipedia.org/wiki/Metaphone

## Support

For issues or questions:
- Email: compliance@forgepay.io
- Slack: #compliance-monitor
- JIRA: ForgePay/COMPLIANCE-*
