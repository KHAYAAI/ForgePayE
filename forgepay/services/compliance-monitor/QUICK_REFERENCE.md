# OFAC Integration — Quick Reference Card

## One-Liner Summary

Real-time transaction screening against OFAC SDN/DPL/EEL with fuzzy+phonetic name matching, Redis caching, and multi-list hit detection.

## Quick Start (30 seconds)

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Set environment
export REDIS_URL=redis://localhost:6379/2
export OFAC_FEED_URL=https://www.treasury.gov/ofac/downloads/ssi/
export LOG_LEVEL=INFO

# 3. Run service
uvicorn src.main:app --port 8003

# 4. Test screening endpoint
curl -X POST http://localhost:8003/v1/screening \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "txn-001",
    "agent_id": "agent-test",
    "counterparty_name": "Acme Corp",
    "amount_usd": 50000
  }'
```

## API Cheat Sheet

| Method | Endpoint | Purpose | Response |
|--------|----------|---------|----------|
| POST | `/v1/screening` | Screen 1 transaction | risk_score, is_match, hits |
| POST | `/v1/screening/batch` | Screen 100+ transactions | Array of results |
| GET | `/v1/sanctions/ofac/status` | Feed status & age | Entry counts, hours old |
| POST | `/v1/sanctions/refresh` | Manual feed update | Refresh status |

## Risk Scoring Quick Guide

| Match Type | Score | Action |
|-----------|-------|--------|
| No match | 0 | ✅ Allow |
| Phonetic match | +50 | 🔍 Review |
| Fuzzy match | +85 | 🔍 Review |
| Exact match | +95 | ⛔ Block |
| Multiple lists | +10 bonus | ⛔ Block |
| Large amount (>$100k) | +10 bonus | (amplifies) |

**Thresholds:**
- 0–39: Allow
- 40–79: Review
- 80–100: Block

## Name Matching Algorithms

```python
# Three-layer matching approach:

1. Fuzzy (token_sort_ratio)
   "ACME TRADING LLC" ≈ 0.87 "ACME TRADE LTD"
   
2. Soundex (phonetic)
   "Smith" = "Smythe" (same Soundex)
   
3. Metaphone (pronunciation)
   "Phillips" = "Philips" (sounds same)
```

## Configuration Essentials

```bash
# Required
OFAC_FEED_URL=https://www.treasury.gov/ofac/downloads/ssi/
REDIS_URL=redis://localhost:6379/2
AUDIT_SERVICE_URL=http://bank-whitelabel:8005

# Optional (with defaults)
OFAC_CACHE_TTL=86400           # 24 hours
FUZZY_MATCH_THRESHOLD=0.85     # 0–1, lower = more matches
OFAC_REFRESH_CRON=0 2 * * *    # 02:00 UTC daily
```

## File Structure

```
compliance-monitor/
├── src/
│   ├── main.py                    # FastAPI app + lifespan
│   ├── config.py                  # Settings/env vars
│   ├── ofac/
│   │   └── feed.py               # OfacFeedManager (CSV download/parse)
│   └── sanctions/
│       └── screening.py           # TransactionScreeningEngine
│   └── routers/
│       └── ofac_screening.py      # API endpoints
├── tests/
│   └── test_ofac_feed_integration.py  # 10+ tests
├── OFAC_INTEGRATION.md            # Full documentation
├── OFAC_USAGE_EXAMPLES.md         # Code examples
└── QUICK_REFERENCE.md             # This file
```

## Common Tasks

### Check Feed Status
```bash
curl http://localhost:8003/v1/sanctions/ofac/status | jq .
```

### Force Feed Refresh
```bash
curl -X POST http://localhost:8003/v1/sanctions/refresh
```

### Screen Transaction (programmatically)
```python
result = await screening_engine.screen_transaction(
    transaction_id="txn-123",
    agent_id="agent-xyz",
    counterparty_name="Company Name",
    amount_usd=50000,
)
print(f"Risk: {result.risk_score}, Match: {result.is_match}")
```

### Batch Screen 100 Transactions
```python
results = await screening_engine.batch_screen(transactions)
# Returns list of results (concurrent processing)
```

### Enable Debug Logging
```python
import logging
logging.basicConfig(level=logging.DEBUG)
# Now see debug messages for name matching
```

## Testing

```bash
# Run all OFAC tests
pytest tests/test_ofac_feed_integration.py -v

# Run specific test class
pytest tests/test_ofac_feed_integration.py::TestNameMatchingAlgorithms -v

# With coverage
pytest tests/test_ofac_feed_integration.py --cov=src.sanctions --cov=src.ofac
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| High false positives | ↑ `FUZZY_MATCH_THRESHOLD` (0.90 instead of 0.85) |
| Missing matches | Check feed status; verify names in CSV |
| Slow screening | Use batch_screen(); verify Redis connection |
| Feed download fails | Check Treasury.gov; uses Redis fallback |
| Service won't start | Check Redis connectivity; verify OFAC_FEED_URL |

## Performance Notes

- **Screening latency**: 10–50 ms per transaction
- **Batch (100 txns)**: 500–1000 ms (concurrent)
- **Feed size**: 12k SDN + 3k DPL + 7k EEL entries
- **Memory**: ~200–300 MB (in-memory + Redis)
- **Cache hit rate**: >95% (Redis)
- **Feed refresh**: 5–30 seconds

## Scheduler Jobs

| Time | Job | Source |
|------|-----|--------|
| 02:00 UTC | OFAC SDN XML refresh | OfacListManager |
| 02:30 UTC | OFAC CSV refresh | OfacFeedManager |
| 03:00 UTC | EU sanctions refresh | EuSanctionsManager |
| Every 5m | AML monitoring | TransactionMonitoringEngine |

## Authentication

All endpoints require either:
1. **JWT Token**: `-H "Authorization: Bearer $TOKEN"`
2. **API Key**: `-H "X-Compliance-API-Key: $KEY"`

Configured in `src/auth.py`

## Deployment

```bash
# Docker
docker run -e REDIS_URL=redis://redis:6379/2 \
           -p 8003:8003 \
           forgepay/compliance-monitor:0.1.0

# Kubernetes (Helm)
helm install compliance-monitor ./infra/helm/compliance-monitor/ \
  --namespace compliance

# Development
uvicorn src.main:app --reload --port 8003
```

## Audit Logging

All screening results are automatically logged to audit service:
```json
POST /v1/audit/screening-event
{
  "event_type": "sanctions_screening",
  "transaction_id": "txn-123",
  "risk_score": 85,
  "is_match": true
}
```

## Key Classes

| Class | Purpose | Location |
|-------|---------|----------|
| `OfacFeedManager` | Download, parse, cache OFAC CSV | src/ofac/feed.py |
| `OfacEntry` | Parsed OFAC entry object | src/ofac/feed.py |
| `TransactionScreeningEngine` | Real-time screening | src/sanctions/screening.py |
| `ScreeningResult` | Screening output | src/sanctions/screening.py |
| `ListType` | Enum (SDN, DPL, EEL) | src/ofac/feed.py |

## Useful Functions

```python
from src.sanctions.screening import (
    soundex,           # Soundex encoding
    metaphone,         # Metaphone encoding
    normalize_name,    # Name normalization
)

soundex("Smith")            # → "S530"
metaphone("Phillips")       # → Phonetic code
normalize_name("ACME INC")  # → "acme"
```

## Important Files to Know

- **src/main.py** — FastAPI app, lifespan, scheduler
- **src/ofac/feed.py** — CSV downloads and caching
- **src/sanctions/screening.py** — Real-time screening logic
- **src/routers/ofac_screening.py** — API endpoints
- **tests/test_ofac_feed_integration.py** — Test suite
- **OFAC_INTEGRATION.md** — Full documentation
- **infra/helm/compliance-monitor/values.yaml** — K8s config

## Links

- [Treasury OFAC Downloads](https://www.treasury.gov/ofac/downloads/)
- [SDN XML Schema](https://home.treasury.gov/system/files/126/sdn_advanced_notes.pdf)
- [Soundex Algorithm](https://en.wikipedia.org/wiki/Soundex)
- [Metaphone](https://en.wikipedia.org/wiki/Metaphone)

## Support

- **Docs**: See OFAC_INTEGRATION.md
- **Examples**: See OFAC_USAGE_EXAMPLES.md
- **Tests**: tests/test_ofac_feed_integration.py
- **Email**: compliance@forgepay.io
- **Slack**: #compliance-monitor

---

**Last Updated:** 2026-05-16  
**Version:** 0.1.0  
**Status:** ✅ Production Ready
