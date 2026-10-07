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

/** Where decisions are made durable. Set by persistence.ts when a database is configured. */
export interface DecisionSink { record(d: Decision): void }
let sink: DecisionSink | null = null;
export function setDecisionSink(s: DecisionSink | null): void { sink = s; }

/** Load the stored recent decisions, oldest first. */
export function hydrateDecisions(decisions: Decision[]): void {
  log.length = 0;
  log.push(...decisions.slice(-MAX_ENTRIES));
}

export function recordDecision(decision: Decision): void {
  log.push(decision);
  sink?.record(decision);
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
