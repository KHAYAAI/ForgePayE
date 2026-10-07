/**
 * Agent Velocity Tracker
 *
 * Per-agent rolling spend windows used by the risk scorer to detect bursts
 * of activity that exceed daily limits. Held in memory per agent (pruned on write) and written
 * through to Postgres by persistence.ts, so a restart does not reset anyone's window.
 */

import { VelocityEntry, VelocityWindow } from './types';

const WINDOW_7D_MS = 7  * 24 * 60 * 60 * 1000;
const WINDOW_24H_MS =      24 * 60 * 60 * 1000;
const WINDOW_1H_MS  =           60 * 60 * 1000;

const ledger: Map<string, VelocityEntry[]> = new Map();

/** Where entries are made durable. Set by persistence.ts when a database is configured. */
export interface VelocitySink { record(agentId: string, timestamp: number, amountUsd: number): void }
let sink: VelocitySink | null = null;
export function setVelocitySink(s: VelocitySink | null): void { sink = s; }

/** Load stored entries (inside the longest window) so a restart does not reset anyone's spend window. */
export function hydrateVelocity(entries: Array<{ agentId: string; timestamp: number; amountUsd: number }>): void {
  ledger.clear();
  for (const e of entries) {
    const list = ledger.get(e.agentId) ?? [];
    list.push({ timestamp: e.timestamp, amountUsd: e.amountUsd });
    ledger.set(e.agentId, list);
  }
}

export function recordTransaction(agentId: string, amountUsd: number, timestamp?: number): void {
  const ts      = timestamp ?? Date.now();
  const entries = ledger.get(agentId) ?? [];
  entries.push({ timestamp: ts, amountUsd });
  ledger.set(agentId, entries);
  prune(agentId, ts);
  sink?.record(agentId, ts, amountUsd);
}

export function getVelocity(agentId: string, now?: number): VelocityWindow {
  const ref     = now ?? Date.now();
  const entries = ledger.get(agentId) ?? [];

  let last1hUsd  = 0;
  let last24hUsd = 0;
  let last7dUsd  = 0;
  let txCount1h  = 0;
  let txCount24h = 0;
  let txCount7d  = 0;

  for (const e of entries) {
    const age = ref - e.timestamp;
    if (age <= WINDOW_7D_MS) {
      last7dUsd  += e.amountUsd;
      txCount7d  += 1;
    }
    if (age <= WINDOW_24H_MS) {
      last24hUsd += e.amountUsd;
      txCount24h += 1;
    }
    if (age <= WINDOW_1H_MS) {
      last1hUsd  += e.amountUsd;
      txCount1h  += 1;
    }
  }

  return {
    agentId,
    last1hUsd,
    last24hUsd,
    last7dUsd,
    txCount1h,
    txCount24h,
    txCount7d,
    computedAt: new Date(ref).toISOString(),
  };
}

export function clearVelocity(): void {
  ledger.clear();
}

function prune(agentId: string, now: number): void {
  const entries = ledger.get(agentId);
  if (!entries) return;
  const cutoff = now - WINDOW_7D_MS;
  const fresh  = entries.filter(e => e.timestamp >= cutoff);
  ledger.set(agentId, fresh);
}
