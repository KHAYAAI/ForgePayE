# ForgePay Compliance Monitor

OFAC/EU sanctions screening, KYC/CDD records, AML transaction monitoring, and
SAR/CTR regulatory reporting. FastAPI, Python 3.12.

## Responsibilities

- **Sanctions screening** — entity/address lookups (`src/screening/engine.py`)
  against OFAC SDN/DPL/EEL and EU consolidated lists, and real-time
  transaction screening (`src/sanctions/screening.py`, mounted at
  `POST /v1/screening`) with fuzzy/phonetic name matching.
- **KYC/CDD** — verification records and risk levels (`src/kyc/manager.py`).
- **AML monitoring** — rule-based transaction monitoring
  (`src/monitoring/engine.py`, `src/monitoring/rules.py`).
- **SAR/CTR reporting** — Suspicious Activity Report and Currency Transaction
  Report lifecycle (`src/reporting/sar.py`).

## Persistence

SAR/CTR filings, KYC records, and AML alerts are real regulatory records and
are stored in Postgres (`src/db/`, SQLAlchemy 2.0 async + Alembic). This
service refuses to boot in production without a real `DATABASE_URL` — see
`src/config.py`'s `model_post_init`. There is no in-memory fallback for these
tables by design: a regulatory record that can vanish on restart isn't one.

The sanctions-screening result cache (`src/screening/engine.py`) is backed by
Redis with a 24h TTL — this one *is* a cache, not a record, so an outage is
logged and tolerated rather than failing the request.

### Migrations

```bash
alembic upgrade head    # requires DATABASE_URL pointed at a real Postgres
```

## What's honest about the FinCEN integration

`src/reporting/sar.py::SarManager.submit_sar()` calls a `FincenFilingProvider`
seam (`src/reporting/fincen.py`). No real provider is wired in — FinCEN's BSA
e-filing system needs real credentials and a PKI filing certificate this
environment doesn't have. The default `UnconfiguredFincenFilingProvider`
never fabricates an acknowledgement id and never reports success; a SAR
submitted through it gets status `"submitted_unfiled"`, not `"filed"` — those
are deliberately distinct values so nothing downstream can mistake "we tried,
nothing is configured" for "FinCEN has this." Wiring a real provider means
implementing `FincenFilingProvider.file_sar()` against FinCEN's actual API
contract and calling `set_fincen_filing_provider()` at startup.

## Running locally

```bash
poetry install
uvicorn src.main:app --reload --port 8005
```

Requires `DATABASE_URL` (Postgres) and `REDIS_URL` — see `src/config.py` for
every setting and its default.

## Tests

```bash
poetry run pytest tests/ -v
```

Persistence tests run against a temp-file sqlite database via `aiosqlite`
(see `tests/conftest.py`) rather than a real Postgres instance — the ORM
models are written to be Postgres/sqlite-portable specifically so the suite
needs no external services. The production path is always Postgres/asyncpg.
