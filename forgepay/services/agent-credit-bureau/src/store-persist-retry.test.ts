/**
 * Regression coverage for the persist() write path added to store.ts: a
 * failed write must retry before giving up, and a write that fails on every
 * attempt must become observable (persistenceFailures) rather than only a
 * console.error line nobody may be watching.
 *
 * Mocks ./db entirely rather than requiring a real Postgres — this is
 * specifically testing the retry/counter behavior in store.ts, not the
 * database round-trip itself (persistence.test.ts, which requires a real
 * DATABASE_URL, covers that end of it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upsertProfile = vi.fn();

vi.mock('./db', async () => {
  const actual = await vi.importActual<typeof import('./db')>('./db');
  return {
    ...actual,
    isDbEnabled: () => true,
    assertPersistenceConfigured: () => {},
    upsertProfile,
  };
});

describe('store.ts persist() — retry and failure observability', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    upsertProfile.mockReset();
    process.env['DATABASE_URL'] = 'postgres://test/test';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('retries a transient failure and succeeds without recording a failure', async () => {
    const store = await import('./store');
    store.resetPersistenceFailuresForTests();

    upsertProfile
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(undefined);

    const profile = { agentId: 'agent_retry_ok' } as import('./types').AgentCreditProfile;
    store.setProfile(profile);

    // setProfile fires persist() without awaiting it (fire-and-forget, by
    // design — the in-memory Map is already updated synchronously). Advance
    // fake timers so the backoff sleep between attempt 1 and 2 elapses, then
    // flush the microtask queue so the retried write actually resolves.
    await vi.advanceTimersByTimeAsync(1000);

    expect(upsertProfile).toHaveBeenCalledTimes(2);
    expect(store.persistenceFailures.get('profile')).toBeUndefined();
    expect(store.totalPersistenceFailures()).toBe(0);
  });

  it('gives up after the bounded retry limit and records the failure', async () => {
    const store = await import('./store');
    store.resetPersistenceFailuresForTests();

    upsertProfile.mockRejectedValue(new Error('database is down'));

    const profile = { agentId: 'agent_retry_fail' } as import('./types').AgentCreditProfile;
    store.setProfile(profile);

    await vi.advanceTimersByTimeAsync(5000);

    // 3 attempts total (the bound in store.ts), not an unbounded retry loop.
    expect(upsertProfile).toHaveBeenCalledTimes(3);
    expect(store.persistenceFailures.get('profile')).toBe(1);
    expect(store.totalPersistenceFailures()).toBe(1);

    // The in-memory read path must still work — a durability failure isn't
    // supposed to take down request-serving.
    expect(store.getProfile('agent_retry_fail')?.agentId).toBe('agent_retry_fail');
  });

  it('counts failures per write kind independently', async () => {
    const store = await import('./store');
    store.resetPersistenceFailuresForTests();

    upsertProfile.mockRejectedValue(new Error('down'));
    store.setProfile({ agentId: 'agent_a' } as import('./types').AgentCreditProfile);
    store.setProfile({ agentId: 'agent_b' } as import('./types').AgentCreditProfile);

    await vi.advanceTimersByTimeAsync(5000);

    expect(store.persistenceFailures.get('profile')).toBe(2);
  });
});
