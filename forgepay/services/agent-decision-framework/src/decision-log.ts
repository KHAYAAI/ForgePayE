/**
 * Decision Audit Log
 *
 * Append-only ring buffer of recent decisions for observability and replay.
 * Capped at 500 entries; oldest evicted first. Production swaps this for
 * an event stream (Kafka) + cold storage in S3.
 */

import { Decision } from './types';

const MAX_ENTRIES = 500;
const log: Decision[] = [];

export function recordDecision(decision: Decision): void {
  log.push(decision);
  if (log.length > MAX_ENTRIES) {
    log.splice(0, log.length - MAX_ENTRIES);
  }
}

export function getDecisionHistory(limit = 50): Decision[] {
  const safe = Math.min(Math.max(limit, 1), MAX_ENTRIES);
  return log.slice(-safe).reverse();
}

export function clearDecisionLog(): void {
  log.length = 0;
}

export function getLogSize(): number {
  return log.length;
}
