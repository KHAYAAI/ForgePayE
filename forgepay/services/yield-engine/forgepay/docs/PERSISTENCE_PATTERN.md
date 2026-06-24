# Write-Through Persistence Pattern

A guide to implementing durable state management in ForgePay services using hybrid in-memory + PostgreSQL storage.

## Overview

The **write-through caching pattern** is the standard approach for persistence across all ForgePay TypeScript services. It provides:

- **Fast reads** from in-memory Maps (O(1), 0.1–1ms latency)
- **Durable writes** to PostgreSQL (best-effort, non-blocking)
- **Graceful degradation** when DATABASE_URL is unset (falls back to in-memory only)
- **Cold-start restoration** — data persists across pod restarts
- **Idempotent mutations** via `ON CONFLICT` clauses, safe against duplicate writes

### The Pattern at a Glance

1. **In-memory tier (L1)** → Multiple Maps<string, Entity> for fast access
2. **PostgreSQL tier (L2)** → Durable storage for state recovery
3. **Write-through flow** → Caller updates cache; writes to DB fire async in background
4. **Read path** → Always check cache first (warm path); fall through to DB only if missing
5. **Flag-gated** → `useDb` boolean controls whether DB writes/migrations run

```
┌─────────────────────────────────────────────────────────┐
│ Application Code (routes, services)                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ putEntity(x), getEntity(id)
                     ▼
┌─────────────────────────────────────────────────────────┐
│ store.ts — Write-through wrapper                        │
│   ├─ Read: cache.get(id)                               │
│   └─ Write: cache.set(id, x); if(useDb) upsertDb(x)   │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼ (fast)                  ▼ (async, best-effort)
    ┌──────────┐              ┌──────────────┐
    │ Maps<K,V>│              │ pg.Pool      │
    │ (L1)     │              │ (L2)         │
    └──────────┘              └──────────────┘
```

When `DATABASE_URL` is unset, writes skip the DB tier entirely. When migrations fail or DB is unavailable, the service logs a warning and continues with in-memory storage.

---

## Pattern Components

Every service implementing this pattern requires four files:

### 1. `src/db.ts` — Database Layer

Handles connection pooling, schema migrations, and CRUD operations.

```typescript
/**
 * PostgreSQL connection pool + migrations for [service name].
 *
 * Tables: [list them]
 */

import { Pool } from 'pg';

// ── Pool initialization ────────────────────────────────

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://forgepay:devpassword@localhost:5432/forgepay_dev',
  max: 10,  // Connection pool size; tune for expected concurrency
});

// ── Run migrations ─────────────────────────────────────

/**
 * Create schema tables if they don't exist.
 * Safe to call multiple times (CREATE TABLE IF NOT EXISTS is idempotent).
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);
    `);
  } finally {
    client.release();
  }
}

// ── CRUD helpers ───────────────────────────────────────

/**
 * Upsert (insert or update) an entity.
 * ON CONFLICT ensures idempotency — duplicate writes are safe.
 * Failures are logged but don't throw (best-effort).
 */
export async function upsertEntity(entity: Entity): Promise<void> {
  await pool.query(
    `INSERT INTO entities (id, name, status, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       status = EXCLUDED.status`,
    [entity.id, entity.name, entity.status, entity.createdAt],
  ).catch((err: Error) => {
    console.warn('[service] upsert failed:', err.message);
  });
}

/**
 * Load all entities from database.
 * Called during startup to restore state.
 */
export async function loadAllEntities(): Promise<Entity[]> {
  if (!pool) return [];
  try {
    const result = await pool.query('SELECT * FROM entities ORDER BY created_at');
    return result.rows.map(rowToEntity);
  } catch (err) {
    console.warn('[service] load failed:', (err as Error).message);
    return [];
  }
}

// ── Row mappers ────────────────────────────────────────

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    status: row['status'] as string,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}
```

### 2. `src/db/migrations/` — SQL Schema Files

One `.sql` file per schema version. Name them sequentially: `001_initial.sql`, `002_add_column.sql`, etc.

**yield-engine example** (`001_yield_positions.sql`):

```sql
-- Migration 001: Create yield_positions table
-- Persists DeFi position records with on-chain deployment metadata.

CREATE TABLE IF NOT EXISTS yield_positions (
  id UUID PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  principal NUMERIC(20, 6) NOT NULL,
  shares NUMERIC(20, 6) NOT NULL,
  current_value NUMERIC(20, 6) NOT NULL,
  unrealized_yield NUMERIC(20, 6) NOT NULL DEFAULT 0,
  realized_yield NUMERIC(20, 6) NOT NULL DEFAULT 0,
  deposited_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(32) NOT NULL DEFAULT 'active' 
    CHECK (status IN ('active', 'withdrawing', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yield_positions_merchant_id ON yield_positions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_yield_positions_vault_id ON yield_positions(vault_id);
CREATE INDEX IF NOT EXISTS idx_yield_positions_status ON yield_positions(status);
```

**Best practices:**
- Use `CREATE TABLE IF NOT EXISTS` for idempotency
- Add indexes on foreign keys and status columns
- Use `TIMESTAMPTZ NOT NULL DEFAULT NOW()` for audit timestamps
- Use `CHECK` constraints for enum fields
- Name constraints explicitly for clarity in error messages

### 3. `src/store.ts` — In-Memory Store with Write-Through

The write-through wrapper. All application code interacts with this module, not db.ts directly.

```typescript
/**
 * Hybrid in-memory + PostgreSQL store.
 *
 * All mutations write through to Postgres (best-effort, non-blocking).
 * Reads always hit the in-memory cache for speed.
 * If DATABASE_URL is unset, falls back to in-memory only.
 */

import { pool, upsertEntity, loadAllEntities } from './db';
import type { Entity } from './types';

// ── In-memory cache (L1) ───────────────────────────────

const entities = new Map<string, Entity>();

// ── Persistence control flag ──────────────────────────

let useDb = false;

// ── Initialization ─────────────────────────────────────

/**
 * Load all state from database into the cache.
 * Called once during startup after migrations.
 */
export async function initStoreFromDb(): Promise<void> {
  if (!process.env['DATABASE_URL']) {
    useDb = false;
    console.info('[service] DATABASE_URL not set; using in-memory storage only');
    return;
  }

  try {
    const rows = await loadAllEntities();
    entities.clear();
    for (const row of rows) {
      entities.set(row.id, row);
    }
    useDb = true;
    console.info(`[service] Loaded ${entities.size} entities from DB`);
  } catch (err) {
    console.warn('[service] DB unavailable, using in-memory store:', (err as Error).message);
    useDb = false;
  }
}

// ── API: reads (always from cache) ────────────────────

export function getEntity(id: string): Entity | undefined {
  return entities.get(id);
}

export function listEntities(): Entity[] {
  return Array.from(entities.values());
}

// ── API: writes (cache first, then DB) ───────────────

/**
 * Upsert entity: update cache immediately, persist to DB in background.
 * Returns the updated entity immediately (doesn't wait for DB write).
 */
export function putEntity(entity: Entity): Entity {
  entities.set(entity.id, entity);
  if (useDb) {
    // Fire-and-forget: write to DB without blocking the caller
    void upsertEntity(entity);
  }
  return entity;
}

/**
 * Delete entity from cache and (if DB enabled) from database.
 */
export function deleteEntity(id: string): boolean {
  const found = entities.delete(id);
  if (found && useDb) {
    void pool.query('DELETE FROM entities WHERE id = $1', [id])
      .catch((err) => console.warn('[service] delete failed:', (err as Error).message));
  }
  return found;
}

// ── Test utility ───────────────────────────────────────

export function _resetStore(): void {
  entities.clear();
  useDb = false;
}
```

### 4. `src/index.ts` — Startup Sequence

Initialize in this order: **database** → **migrations** → **load cache** → **listen**

```typescript
import Fastify from 'fastify';
import { runMigrations } from './db';
import { initStoreFromDb } from './store';
import { buildRoutes } from './routes';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

async function main(): Promise<void> {
  // Step 1: Initialize database (run migrations only if DATABASE_URL is set)
  if (process.env['DATABASE_URL']) {
    try {
      await runMigrations();
      console.log('[service] Migrations completed');
    } catch (err) {
      console.error('[service] Migration failed:', err);
      process.exit(1);
    }
  }

  // Step 2: Load cache from database (or seed in-memory defaults)
  await initStoreFromDb();

  // Step 3: Build app and attach routes
  const app = await Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });
  await buildRoutes(app);

  // Step 4: Start listening
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[service] Listening on :${PORT}`);
}

main().catch((err) => {
  console.error('[service] Startup failed:', err);
  process.exit(1);
});
```

---

## Implementation Checklist

Use this when adding persistence to a new service or refactoring existing in-memory-only code:

- [ ] **Create `src/db.ts`**
  - [ ] Import `Pool` from `pg`
  - [ ] Export `pool` with `connectionString` from `DATABASE_URL`
  - [ ] Implement `runMigrations()` with `CREATE TABLE IF NOT EXISTS`
  - [ ] Implement CRUD helpers (upsert, load, row mappers)
  - [ ] All DB errors caught and logged, never thrown

- [ ] **Create `src/db/migrations/` directory**
  - [ ] Write schema `.sql` files sequentially named
  - [ ] Test each migration with `psql -f migration.sql`

- [ ] **Rewrite `src/store.ts`**
  - [ ] Replace global `const entitiesMap = new Map()` with cache pattern
  - [ ] Implement `initStoreFromDb()` to load cache on startup
  - [ ] Rewrite all mutators (`put*`, `delete*`) to call db helpers if `useDb === true`
  - [ ] Leave all accessors (`get*`, `list*`) unchanged (they only read from cache)
  - [ ] Use `void upsertEntity(entity)` to fire-and-forget DB writes

- [ ] **Update `src/index.ts`**
  - [ ] Call `runMigrations()` before `initStoreFromDb()`
  - [ ] Call `initStoreFromDb()` before `app.listen()`
  - [ ] Don't let migration errors block startup (log and continue, or fail depending on SLA)

- [ ] **Add environment variables**
  - [ ] `DATABASE_URL` (optional; defaults to local dev database)
  - [ ] Document in `.env.example`

- [ ] **Write integration tests**
  - [ ] Test with `DATABASE_URL` set (full persistence)
  - [ ] Test with `DATABASE_URL` unset (in-memory fallback)
  - [ ] Test cold start (load from DB after initialization)

---

## Environment Variables

Add to `.env.example`:

```bash
# Database persistence (optional; unset for in-memory only)
# Format: postgresql://user:password@host:port/database
DATABASE_URL=postgresql://forgepay:devpassword@localhost:5432/forgepay_dev

# Optional: debug logging for database operations
LOG_LEVEL=info
```

When `DATABASE_URL` is unset:
- Migrations are skipped
- `useDb` flag stays `false`
- All mutations only touch in-memory Maps
- Service continues to work normally

---

## Code Examples from Existing Services

### agent-credit-lines: Simple in-memory Maps → PostgreSQL

```typescript
// store.ts: Simple CRUD pattern
export function putCreditLine(line: CreditLine): CreditLine {
  creditLines.set(line.id, line);
  if (useDb) void upsertLineToDb(line);  // Fire-and-forget
  return line;
}

export function getCreditLine(id: string): CreditLine | undefined {
  return creditLines.get(id);  // Always from cache
}
```

**db.ts: Upsert with ON CONFLICT**

```typescript
async function upsertLineToDb(line: CreditLine): Promise<void> {
  await pool.query(
    `INSERT INTO credit_lines (id, agent_id, limit_usd, available_usd, used_usd, ...)
     VALUES ($1, $2, $3, $4, $5, ...)
     ON CONFLICT (id) DO UPDATE SET
       available_usd = EXCLUDED.available_usd,
       used_usd = EXCLUDED.used_usd`,
    [line.id, line.agentId, ...]
  ).catch((err: Error) => console.warn('[credit-store] upsert failed:', err.message));
}
```

### yield-engine: File-based Migrations

**db.ts: Auto-load migrations from disk**

```typescript
async function runMigrations(): Promise<void> {
  const client = await getPool().connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Load and run migration files in order
    const migrationsDir = path.join(__dirname, 'db', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      // Skip if already applied
      const result = await client.query(
        'SELECT id FROM _migrations WHERE name = $1',
        [file]
      );
      if (result.rows.length > 0) continue;

      // Execute migration in transaction
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('[db] Applied migration:', file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
```

**store.ts: Load positions on startup**

```typescript
export async function initPositionsFromDb(): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT id, merchant_id, vault_id, principal, current_value, ...
      FROM yield_positions
      ORDER BY last_updated_at DESC
    `);

    positionsStore.clear();
    for (const row of result.rows) {
      const position: YieldPosition = { ... };
      positionsStore.set(position.id, position);
    }

    console.log(`[store] Loaded ${positionsStore.size} positions from DB`);
  } catch (err) {
    console.warn('[store] Failed to load positions from DB');
    // Don't rethrow; continue with empty store
  }
}
```

### agent-identity: Seed Data + Dynamic Migrations

Services often combine seed data (for tests) with persistent storage:

```typescript
// store.ts: Seed in-memory at module load
const agentMap = new Map<string, AgentIdentity>();
let useDb = false;

// Seed defaults before DB initialization so tests don't require DATABASE_URL
seedInMemory();

export async function initStore(): Promise<void> {
  if (!process.env['DATABASE_URL']) {
    useDb = false;
    // Seed was already applied at module load
    return;
  }

  try {
    await runMigrations();
    await loadStoreFromDb();  // Overlay DB state on top of seed
    useDb = true;
  } catch (err) {
    console.warn('[identity] DB unavailable, using seed only:', err.message);
    useDb = false;
  }
}
```

---

## Graceful Degradation

### Scenario 1: `DATABASE_URL` Not Set

```typescript
// Detected in store.ts during initialization:
if (!process.env['DATABASE_URL']) {
  useDb = false;
  console.info('[service] Using in-memory storage (DATABASE_URL not set)');
  return;
}
```

**Behavior:** Service works normally with all data in RAM. No persistence across restarts.

### Scenario 2: Database Connection Fails on Startup

```typescript
// In index.ts:
try {
  await runMigrations();
  await initStoreFromDb();
  useDb = true;
} catch (err) {
  console.warn('[service] DB unavailable, continuing with in-memory:', err);
  useDb = false;  // Falls back to in-memory; don't crash
}
```

**Behavior:** Service logs warning, skips DB writes, continues. Loss of persistence but no downtime.

### Scenario 3: Single Database Write Fails

```typescript
// In store.ts:
export function putEntity(entity: Entity): Entity {
  entities.set(entity.id, entity);  // Update cache immediately
  if (useDb) {
    void upsertEntity(entity);  // If this fails, we don't care
  }
  return entity;  // Return to caller immediately
}

// In db.ts:
export async function upsertEntity(entity: Entity): Promise<void> {
  await pool.query(...).catch((err: Error) => {
    console.warn('[service] DB write failed:', err.message);
    // Don't rethrow; caller already has cached value
  });
}
```

**Behavior:** Caller gets immediate response. Cache is up-to-date. DB write failure is logged but not fatal. Eventually the write will succeed (retry via background job or next mutation).

### Scenario 4: Pod Restarts with Database Available

```typescript
// Database still has prior state from Scenario 2 or 3
// On restart:
await initStoreFromDb();  // Loads all state back into cache
// Service is back online with prior data intact
```

---

## Performance Considerations

### Read Latency

- **Cache hit (common case):** 0.1–1ms (memory access only)
- **Cache miss (rare case):** 1–50ms (database query + network)

Optimization: Warm the cache on startup with `initStoreFromDb()`, so most requests hit the cache.

### Write Latency

- **User sees:** ~0.1ms (cache update only)
- **Database sees:** Async in background (1–50ms network + query time)

No blocking; caller gets immediate response. Database writes are best-effort.

### Connection Pooling

Default pool size: `max: 10`. For services with high concurrency, tune via:

```typescript
export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: parseInt(process.env['DB_POOL_SIZE'] ?? '10', 10),
  min: 2,           // Maintain minimum connections
  idleTimeoutMillis: 30_000,
});
```

### Idempotency

All mutations use `ON CONFLICT` (upsert semantics):

```sql
INSERT INTO entities (id, name) VALUES ($1, $2)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
```

This ensures:
- Duplicate writes (from retries or race conditions) are safe
- Last write wins (simple semantics, no version tracking)
- No duplicate key errors

---

## Services Using This Pattern

### Fully Implemented (Production)

| Service | Entity | Tables | DB Status |
|---------|--------|--------|-----------|
| **agent-credit-lines** | Credit lines, draws, defaults | 3 | active |
| **agent-identity** | Agent profiles, reputation events | 3 | active |
| **yield-engine** | Positions, sweep configs, transactions | 3 | active |
| **rwa-registry** | RWA vault records, NAV pricing | TBD | in progress |
| **enterprise-treasury** | Netting flows, settlement rules | TBD | in progress |

### Partial (File-based Migrations)

| Service | Notes |
|---------|-------|
| **stablecoin-gateway** | Has db.ts; partial migrations directory |
| **crypto-gateway** | Has db.ts; needs store.ts refactor |
| **unified-router** | Has migrations; in-memory store only |

### Should Adopt This Pattern

| Service | Reason |
|---------|--------|
| **agent-decision-framework** | Mutable decision state → durability |
| **agent-negotiation** | Negotiation state needs recovery |
| **institutional-reporting** | Report generation state |
| **bank-connectivity** | Bank sync state |

---

## Implementation Workflow

For a new service or service refactor:

### 1. Design Schema (1 hour)

Write `.sql` migration files with `CREATE TABLE IF NOT EXISTS` statements. Index foreign keys and high-cardinality columns.

### 2. Implement `db.ts` (1 hour)

- Export `pool` with correct `connectionString`
- Implement `runMigrations()` that runs all `.sql` files
- Implement CRUD helpers (upsert, load)
- All errors logged, never thrown

### 3. Rewrite `store.ts` (1 hour)

- Keep all Maps (they're now the cache)
- Add `initStoreFromDb()` to populate cache
- Prefix all mutations with cache update; follow with `if (useDb) void dbHelper()`
- Leave reads unchanged

### 4. Update `index.ts` (30 min)

- Call `runMigrations()` first
- Call `initStoreFromDb()` before `app.listen()`
- Handle errors gracefully

### 5. Add environment variables (15 min)

- Document `DATABASE_URL` in `.env.example`
- Optional: add `DB_POOL_SIZE`

### 6. Test (1 hour)

- Test with `DATABASE_URL` set (full persistence)
- Test with `DATABASE_URL` unset (in-memory fallback)
- Test cold restart (load from DB)
- Test duplicate writes (ON CONFLICT safety)

**Total:** 4–5 hours per service.

---

## FAQ

**Q: What if a mutation happens while the DB write is still in flight?**

A: The cache is updated first, so the next read sees the latest value immediately. The DB write is best-effort and will eventually succeed. If it fails, the service logs a warning and continues; the next mutation will retry the write.

**Q: Can I have strong consistency with this pattern?**

A: No. The cache is source-of-truth for reads (within a single pod). For a brief window after a write, the cache is ahead of the database. Use this pattern only for services that can tolerate eventual consistency (most ForgePay services).

**Q: How do I handle migrations that take a long time?**

A: Run migrations outside the critical path. In `index.ts`, wrap `runMigrations()` in a timeout or background job. If it takes too long, log a warning and start the service with `useDb = false` (in-memory only) until the migration completes.

**Q: Should I use transactions for multi-table writes?**

A: Yes. Wrap multi-step operations in a database transaction:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO table1 ...');
  await client.query('INSERT INTO table2 ...');
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

**Q: How do I test the store without a database?**

A: Import the module; `initStoreFromDb()` will gracefully skip if `DATABASE_URL` is unset. Use the `_resetStore()` utility to clear state between tests:

```typescript
beforeEach(() => store._resetStore());

test('putEntity without DB', () => {
  const entity = store.putEntity({ id: 'test', ... });
  expect(store.getEntity('test')).toEqual(entity);
});
```

**Q: How do I migrate data from in-memory to PostgreSQL?**

A: Add a background job that reads all in-memory entities and writes them to the database:

```typescript
async function migrateToDb(): Promise<void> {
  for (const entity of store.listEntities()) {
    await db.upsertEntity(entity);
  }
}
```

Call this once when the database first becomes available, then delete it.

---

## Summary

The write-through pattern is **simple, effective, and used by all ForgePay TypeScript services**:

- **Reads:** In-memory cache only (fast)
- **Writes:** Cache first, then database (non-blocking)
- **Startup:** Migrations, then load cache, then listen
- **Fallback:** Works fine without DATABASE_URL (in-memory only)

Implement it in 4–5 hours per service. The pattern scales from single entities (credit lines) to complex graphs (agent reputation + transactions). Use `ON CONFLICT` for idempotency, catch DB errors without rethrowing, and always prioritize cache consistency within a pod.
