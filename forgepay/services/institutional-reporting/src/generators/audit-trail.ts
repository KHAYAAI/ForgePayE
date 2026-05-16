/**
 * Audit Trail Report Generator
 *
 * Pulls admin action events from bank-whitelabel (which holds the SOX-grade
 * append-only audit log) and produces a SOX-style auditor report grouped by
 * actor and action with a filtered list of critical events.
 *
 * Auth: the caller's internal JWT (x-internal-jwt) is forwarded unchanged so
 * downstream services can attribute the read.
 */

import type {
  AuditTrailReport,
  AuditEvent,
  ReportPeriod,
} from '../types';

export interface AuditTrailInput {
  periodStart: string;
  periodEnd: string;
  bankWhitelabelBaseUrl: string;
  internalJwt?: string;
}

interface AuditResponse {
  data?: AuditEvent[];
  events?: AuditEvent[];
}

const FETCH_TIMEOUT_MS = 15_000;

const CRITICAL_ACTION_RE = /^(customer\.suspend|rule\.(disable|delete)|credit_line\.close|bank\.update|admin\.create)$/;

export async function generateAuditTrailReport(
  input: AuditTrailInput,
): Promise<AuditTrailReport> {
  const period: ReportPeriod = { start: input.periodStart, end: input.periodEnd };
  const errors: string[] = [];
  let events: AuditEvent[] = [];

  const headers: Record<string, string> = { accept: 'application/json' };
  if (input.internalJwt) headers['x-internal-jwt'] = input.internalJwt;

  try {
    const url = new URL(`${input.bankWhitelabelBaseUrl}/v1/audit`);
    url.searchParams.set('start', input.periodStart);
    url.searchParams.set('end',   input.periodEnd);
    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      errors.push(`audit: HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as AuditResponse;
      events = body.data ?? body.events ?? [];
    }
  } catch (err) {
    errors.push(`audit: ${(err as Error).message}`);
  }

  const byActor: Record<string, number>  = {};
  const byAction: Record<string, number> = {};
  const criticalEvents: AuditEvent[] = [];

  for (const ev of events) {
    if (ev.actor)  byActor[ev.actor]  = (byActor[ev.actor]  ?? 0) + 1;
    if (ev.action) byAction[ev.action] = (byAction[ev.action] ?? 0) + 1;
    if (ev.action && CRITICAL_ACTION_RE.test(ev.action)) {
      criticalEvents.push(ev);
    }
  }

  const report: AuditTrailReport = {
    period,
    totalEvents: events.length,
    byActor,
    byAction,
    criticalEvents,
  };
  if (errors.length > 0) report.data_source_errors = errors;
  return report;
}

export { CRITICAL_ACTION_RE };
