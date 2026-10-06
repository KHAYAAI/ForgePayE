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

## Sanctions lists and South African reporting (added 2026-10-05)

### Lists screened

| List | Source | Format status |
|---|---|---|
| OFAC SDN | treasury.gov XML | in use before this change |
| EU consolidated | EU FSF XML | in use before this change |
| UN Security Council consolidated | `UN_SANCTIONS_URL` (default: scsanctions.un.org XML) | parser follows the published layout; tested on a hand-written fixture only |
| UK sanctions list | `UK_SANCTIONS_URL` (no default) | **format to confirm**: CSV with configurable columns (`UK_SANCTIONS_*`). The UK list moved from OFSI's consolidated list to the FCDO UK Sanctions List |
| South Africa TFS (FIC) | `ZA_TFS_URL` (no default) | XML dataset (`<NewDataSet>`, `<Table>` individuals, `<Table1>` entities), parsed and checked against a full copy of the file (1,002 entries, 713 aliases); a CSV is still accepted. A `file://` source is accepted for a recorded copy (`ZA_TFS_SNAPSHOT_AT` required; age counts from it; `ZA_TFS_MAX_AGE_HOURS` sets this list's own limit). A copy is bundled in `src/data/`. |

Screening fails closed: every list in use must be loaded and younger than
`SANCTIONS_MAX_AGE_HOURS`, or screening answers `error` (never `clear`). This
now includes the EU list, which was not checked before. In production the
South African TFS list is required (`REQUIRE_ZA_TFS`, default true there): until
`ZA_TFS_URL` is set and loads, nobody can be cleared — including the credit
bureau's sanctions screen.

A downloaded file that parses to zero entries is rejected and the previous
copy kept: an empty parse is a format problem, not an empty list.

### goAML report drafts (FIC)

`POST /api/v1/reporting/goaml/str/{sar_id}` and `/goaml/ctr/{ctr_id}` (admin
only) build a goAML-style XML draft from an existing SAR or CTR and record the
approving officer (`goaml_exports`, listed at `GET /api/v1/reporting/goaml/exports`).

- **Nothing is submitted to the FIC.** Filing is a compliance officer's action
  in the goAML portal under the institution's own registration
  (`FIC_RENTITY_ID`).
- **Not validated against the FIC goAML XSD.** Validate every export first.
- **CTR threshold** is `ZA_CTR_THRESHOLD_ZAR` (default R49,999.99). Confirm the
  current figure under s28 of the FIC Act and its regulations.

### To confirm with counsel / the FIC

- Whether FORGE (or each product) is an accountable or reporting institution
  under the FIC Act, and its registration with the FIC.
- Which reports apply (STR/SAR under s29, CTR under s28, TPR under s28A,
  IFTR) and their deadlines.
- Current UK and TFS list URLs and file formats.
- No PEP source is integrated.
