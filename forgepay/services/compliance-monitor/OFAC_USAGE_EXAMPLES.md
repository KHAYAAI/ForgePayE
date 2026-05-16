# OFAC Integration Usage Examples

## Quick Start

### 1. Initialize Service (in main.py)

```python
from src.ofac.feed import OfacFeedManager, ListType
from src.sanctions.screening import TransactionScreeningEngine
import redis.asyncio as redis

# Connect to Redis
redis_client = await redis.from_url("redis://localhost:6379/2")

# Initialize OFAC feed manager
ofac_feed_manager = OfacFeedManager(
    redis_client=redis_client,
    feed_base_url="https://www.treasury.gov/ofac/downloads/ssi/",
    cache_ttl_seconds=86_400,  # 24 hours
)

# Refresh feeds on startup
await ofac_feed_manager.refresh_all_feeds()

# Initialize screening engine
screening_engine = TransactionScreeningEngine(
    ofac_manager=ofac_feed_manager,
    audit_service_url="http://audit-service:8005",
    fuzzy_threshold=0.85,
)
```

### 2. Screen Single Transaction

```python
result = await screening_engine.screen_transaction(
    transaction_id="txn-2026-05-16-001",
    agent_id="agent-acme",
    counterparty_name="Acme Trading Corporation",
    amount_usd=50_000.00,
)

print(f"Risk Score: {result.risk_score}")
print(f"Is Match: {result.is_match}")
print(f"Matched Entries: {result.matched_entries}")
print(f"Hit Reasons: {result.hit_reasons}")
```

### 3. Batch Screen Multiple Transactions

```python
transactions = [
    {
        "transaction_id": "txn-001",
        "agent_id": "agent-xyz",
        "counterparty_name": "Company A Inc",
        "amount_usd": 25_000.00,
    },
    {
        "transaction_id": "txn-002",
        "agent_id": "agent-xyz",
        "counterparty_name": "Company B LLC",
        "amount_usd": 75_000.00,
    },
    {
        "transaction_id": "txn-003",
        "agent_id": "agent-xyz",
        "counterparty_name": "John Smith Trading",
        "amount_usd": 10_000.00,
    },
]

results = await screening_engine.batch_screen(transactions)

for result in results:
    if result.is_match:
        print(f"{result.transaction_id}: FLAGGED (score={result.risk_score})")
    else:
        print(f"{result.transaction_id}: CLEAR")
```

### 4. Get Feed Status

```python
status = ofac_feed_manager.get_feed_status()

print(f"SDN entries: {status['SDN']['entry_count']}")
print(f"SDN age: {status['SDN']['age_hours']:.1f} hours")
print(f"DPL entries: {status['DPL']['entry_count']}")
print(f"EEL entries: {status['EEL']['entry_count']}")
```

### 5. Manually Refresh Feeds

```python
result = await ofac_feed_manager.refresh_all_feeds()

print(f"SDN: {result['SDN']['entry_count']} entries, status={result['SDN']['cache_status']}")
print(f"DPL: {result['DPL']['entry_count']} entries")
print(f"EEL: {result['EEL']['entry_count']} entries")
```

## API Endpoint Examples

### Screen Transaction via HTTP

```bash
curl -X POST http://localhost:8003/v1/screening \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "txn-2026-05-16-001",
    "agent_id": "agent-acme",
    "counterparty_name": "Acme Trading Inc",
    "amount_usd": 50000.00
  }'
```

**Success Response (200 OK):**
```json
{
  "transaction_id": "txn-2026-05-16-001",
  "agent_id": "agent-acme",
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

### Batch Screen via HTTP

```bash
curl -X POST http://localhost:8003/v1/screening/batch \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [
      {
        "transaction_id": "txn-001",
        "agent_id": "agent-xyz",
        "counterparty_name": "Company A",
        "amount_usd": 25000.00
      },
      {
        "transaction_id": "txn-002",
        "agent_id": "agent-xyz",
        "counterparty_name": "Company B",
        "amount_usd": 75000.00
      }
    ]
  }'
```

### Check OFAC Feed Status

```bash
curl http://localhost:8003/v1/sanctions/ofac/status \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response:**
```json
{
  "last_refresh": "2026-05-16T02:35:12.345678Z",
  "feeds": {
    "SDN": {
      "entry_count": 12345,
      "age_hours": 22.8,
      "hash": "abc123de"
    },
    "DPL": {
      "entry_count": 3456,
      "age_hours": 22.8,
      "hash": "def456ab"
    },
    "EEL": {
      "entry_count": 6789,
      "age_hours": 22.8,
      "hash": "ghi789cd"
    }
  },
  "source": "csv_feeds"
}
```

### Manually Refresh Feeds

```bash
curl -X POST http://localhost:8003/v1/sanctions/refresh \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response:**
```json
{
  "status": "success",
  "SDN": {
    "entry_count": 12345,
    "age_hours": 0.05,
    "cache_status": "refreshed"
  },
  "DPL": {
    "entry_count": 3456,
    "age_hours": 0.05,
    "cache_status": "refreshed"
  },
  "EEL": {
    "entry_count": 6789,
    "age_hours": 0.05,
    "cache_status": "refreshed"
  }
}
```

## Name Matching Algorithm Examples

### Fuzzy Matching (token_sort_ratio)

```python
from src.sanctions.screening import normalize_name
from fuzzywuzzy import fuzz

query = "ACME TRADING INC"
entry = "ACME TRADE LIMITED"

norm_query = normalize_name(query)      # "acme trading"
norm_entry = normalize_name(entry)      # "acme trade limited"

score = fuzz.token_sort_ratio(norm_query, norm_entry) / 100.0
# score ≈ 0.87 (matches because "trading" and "trade" are similar)
```

### Soundex Matching (Phonetic)

```python
from src.sanctions.screening import soundex

soundex("Smith")     # "S530"
soundex("Smythe")    # "S530"  → Match! (same Soundex)
soundex("Johnson")   # "J525"
soundex("Jonson")    # "J525"  → Match! (phonetic variant)
```

### Metaphone Matching (English Pronunciation)

```python
from src.sanctions.screening import metaphone

metaphone("Phillips")   # Returns phonetic code
metaphone("Philips")    # Similar code (pronounced the same)
metaphone("Knight")     # Returns code without 'K'
metaphone("Night")      # Same code (sounds identical)
```

## Risk Scoring Examples

### Example 1: Exact SDN Match + Large Amount

```python
result = await screening_engine.screen_transaction(
    transaction_id="txn-exact",
    agent_id="agent-test",
    counterparty_name="AL-RASHID ALI HASSAN",  # Exact match in SDN
    amount_usd=250_000.00,  # Large amount
)

# Risk Score Calculation:
# - SDN exact match (>= 0.98): +95
# - Large transaction (> $100k): +10
# Total: 100 (capped)
#
# Result:
# risk_score = 100
# is_match = True
# recommended_action = "block"
```

### Example 2: Fuzzy Match + Multiple Lists

```python
result = await screening_engine.screen_transaction(
    transaction_id="txn-multi",
    agent_id="agent-test",
    counterparty_name="SUSPICIOUS ENTITY",  # Matches on SDN, DPL, EEL
    amount_usd=50_000.00,
)

# Risk Score Calculation:
# - SDN fuzzy match (0.85–0.98): +85
# - DPL match: +75 (but max is kept at 85)
# - EEL match: +60 (kept at 85)
# - Multiple list hits (3 lists): +10
# Total: 95
#
# Result:
# risk_score = 95
# is_match = True
# recommended_action = "block"
# matched_entries has 3 entries (one from each list)
```

### Example 3: Phonetic Match (Low Risk)

```python
result = await screening_engine.screen_transaction(
    transaction_id="txn-phonetic",
    agent_id="agent-test",
    counterparty_name="RASHEEDI",  # Sounds like "RASHID"
    amount_usd=10_000.00,
)

# Risk Score Calculation:
# - Phonetic match (soundex): +50
# - No large amount modifier
# Total: 50
#
# Result:
# risk_score = 50
# is_match = True (>= 40)
# recommended_action = "review"
```

### Example 4: No Match

```python
result = await screening_engine.screen_transaction(
    transaction_id="txn-clean",
    agent_id="agent-test",
    counterparty_name="John Smith Consulting LLC",
    amount_usd=100_000.00,
)

# Risk Score Calculation:
# - No matches in any list: 0
# - Large amount modifier: +10 (only if there's a match)
# Total: 0
#
# Result:
# risk_score = 0
# is_match = False
# recommended_action = "allow"
# matched_entries = []
```

## Integration with Audit Service

The screening engine automatically logs all results to the audit service:

```python
# This is done automatically inside screen_transaction()
await screening_engine._log_to_audit(result)

# Audit service receives:
# POST http://audit-service/v1/audit/screening-event
# {
#   "event_type": "sanctions_screening",
#   "agent_id": "agent-xyz",
#   "transaction_id": "txn-001",
#   "counterparty_name": "...",
#   "amount_usd": 50000.00,
#   "risk_score": 85,
#   "is_match": true,
#   "matched_entries": [...],
#   "hit_reasons": [...],
#   "timestamp": "2026-05-16T12:34:56.789123Z"
# }
```

## Scheduler Integration

The service automatically runs these jobs:

```python
# In main.py lifespan context manager:

# OFAC CSV feeds refresh — daily at 02:30 UTC (after XML refresh)
scheduler.add_job(
    ofac_feed_manager.refresh_all_feeds,
    trigger="cron",
    hour=2,
    minute=30,
    id="ofac_csv_refresh",
    name="OFAC CSV Feeds Refresh (SDN, DPL, EEL)",
    max_instances=1,
    coalesce=True,
)
```

## Error Handling Examples

### Feed Unavailable (Graceful Fallback)

```python
# If Treasury.gov is down:
# 1. Service logs warning
# 2. Loads from Redis cache (if available)
# 3. If no cache, returns cached data with `cache_status: "fallback"`
# 4. Service continues with degraded performance

result = await ofac_feed_manager.refresh_feed(ListType.SDN)
# If failed: result = {
#   "list_type": "SDN",
#   "error": "Failed to download and no cached fallback available",
#   ...
# }
```

### Invalid Screening Request

```bash
# Missing required field
curl -X POST http://localhost:8003/v1/screening \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"transaction_id": "txn-001"}'  # Missing other fields

# Response: 422 Unprocessable Entity
# {
#   "detail": "Missing required field: agent_id"
# }
```

### Screening Engine Not Initialized

```bash
curl http://localhost:8003/v1/screening \
  -H "Authorization: Bearer $JWT_TOKEN"

# Response: 503 Service Unavailable
# {
#   "detail": "Screening engine not initialized"
# }
```

## Testing Examples

### Unit Test: Name Matching

```python
def test_soundex_matching():
    from src.sanctions.screening import soundex
    
    assert soundex("Smith") == soundex("Smythe")
    assert soundex("Johnson") == soundex("Jonson")
```

### Integration Test: Full Screening Flow

```python
@pytest.mark.asyncio
async def test_full_screening():
    # Setup mock data
    ofac_feed_manager._entries[ListType.SDN] = [
        OfacEntry(
            uid="123",
            full_name="TEST ENTITY",
            list_type=ListType.SDN,
        ),
    ]
    
    engine = TransactionScreeningEngine(ofac_feed_manager)
    result = await engine.screen_transaction(
        transaction_id="txn-test",
        agent_id="agent-test",
        counterparty_name="TEST ENTITY",
        amount_usd=50_000.00,
    )
    
    assert result.is_match is True
    assert result.risk_score >= 80
```

## Performance Tips

1. **Batch Screening**: Use `batch_screen()` for multiple transactions (concurrent processing)
2. **Cache Warmup**: Call `refresh_all_feeds()` on startup for faster first requests
3. **Threshold Tuning**: Increase `FUZZY_MATCH_THRESHOLD` to reduce false positives
4. **Redis Optimization**: Use Redis Cluster for better concurrency
5. **Monitoring**: Track screening latency with Prometheus metrics

## Debugging

Enable debug logging:

```python
import logging
import structlog

# Set log level to DEBUG
logging.basicConfig(level=logging.DEBUG)
logger = structlog.get_logger(__name__)

logger.debug("screening_details", transaction_id="txn-001", ...)
```

Check feed status for troubleshooting:

```bash
# Get detailed feed info
curl http://localhost:8003/health

# Includes:
# "ofac_list_age_hours": 2.5
# "ofac_entry_count": 12345
```

## Production Deployment Checklist

- [ ] Redis cache running and accessible
- [ ] OFAC_FEED_URL configured (Treasury.gov base URL)
- [ ] OFAC_CACHE_TTL set to 86400 (24 hours)
- [ ] AUDIT_SERVICE_URL pointing to bank-whitelabel service
- [ ] JWT_SECRET configured for auth
- [ ] FUZZY_MATCH_THRESHOLD tuned for your use case
- [ ] APScheduler jobs scheduled (02:00, 02:30, 03:00 UTC)
- [ ] Health checks configured in load balancer
- [ ] Monitoring/alerting set up for feed refresh failures
- [ ] Audit logging integration tested
