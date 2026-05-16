/**
 * In-Memory Store
 *
 * Holds credit lines, draws, and default records for the lifetime of the
 * process. Production deployment swaps this for Postgres (one row per
 * entity) — interface kept narrow so the substitution stays localized.
 */

import { CreditLine, CreditDraw, DefaultRecord } from './types';

const creditLines = new Map<string, CreditLine>();
const draws       = new Map<string, CreditDraw>();
const defaults: DefaultRecord[] = [];

// ── CreditLine ────────────────────────────────────────────────────────────────

export function putCreditLine(line: CreditLine): CreditLine {
  creditLines.set(line.id, line);
  return line;
}

export function getCreditLine(id: string): CreditLine | undefined {
  return creditLines.get(id);
}

export function listCreditLines(): CreditLine[] {
  return Array.from(creditLines.values());
}

export function listCreditLinesByAgent(agentId: string): CreditLine[] {
  return listCreditLines().filter((l) => l.agentId === agentId);
}

export function deleteCreditLine(id: string): boolean {
  return creditLines.delete(id);
}

// ── CreditDraw ────────────────────────────────────────────────────────────────

export function putDraw(draw: CreditDraw): CreditDraw {
  draws.set(draw.id, draw);
  return draw;
}

export function getDraw(id: string): CreditDraw | undefined {
  return draws.get(id);
}

export function listDraws(): CreditDraw[] {
  return Array.from(draws.values());
}

export function listDrawsByLine(creditLineId: string): CreditDraw[] {
  return listDraws().filter((d) => d.creditLineId === creditLineId);
}

// ── DefaultRecord ─────────────────────────────────────────────────────────────

export function addDefault(record: DefaultRecord): DefaultRecord {
  defaults.push(record);
  return record;
}

export function listDefaults(): DefaultRecord[] {
  return [...defaults];
}

// ── Test utility — reset all in-memory state ──────────────────────────────────

export function _resetStore(): void {
  creditLines.clear();
  draws.clear();
  defaults.length = 0;
}
