/**
 * Report store.
 *
 * Keyed by UUIDv4. Holds both metadata (for list views) and the full payload, in memory, and written through to Postgres by
 * persistence.ts so a restart does not lose them. Retention and S3 archival of large exports are still to do.
 */

import { randomUUID } from 'node:crypto';
import type {
  ReportMetadata,
  ReportPayload,
  ReportType,
  ReportPeriod,
} from './types';

export interface StoredReport {
  metadata: ReportMetadata;
  payload: ReportPayload;
}

const reports = new Map<string, StoredReport>();

/** Where reports are made durable. Set by persistence.ts when a database is configured. */
export interface ReportSink {
  save(id: string, metadata: ReportMetadata, payload: ReportPayload): void;
}
let sink: ReportSink | null = null;
export function setReportSink(s: ReportSink | null): void { sink = s; }

/** Load stored reports (the most recent ones) into memory, replacing what is there. */
export function hydrateReports(stored: StoredReport[]): void {
  reports.clear();
  for (const r of stored) reports.set(r.metadata.id, r);
}

export function saveReport(
  type: ReportType,
  period: ReportPeriod,
  payload: ReportPayload,
  generatedByCorrelationId?: string,
): ReportMetadata {
  const id = randomUUID();
  const generatedAt = new Date().toISOString();
  const serialized = JSON.stringify(payload);
  const metadata: ReportMetadata = {
    id,
    type,
    period,
    generatedAt,
    sizeBytes: Buffer.byteLength(serialized, 'utf8'),
    ...(generatedByCorrelationId ? { generatedByCorrelationId } : {}),
  };
  reports.set(id, { metadata, payload });
  sink?.save(id, metadata, payload);
  return metadata;
}

export function getReport(id: string): StoredReport | undefined {
  return reports.get(id);
}

export function listReports(): ReportMetadata[] {
  return Array.from(reports.values())
    .map((r) => r.metadata)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export function deleteReport(id: string): boolean {
  // Memory only. Durable removal (including a report older than what was loaded at start) is removeStoredReport in persistence.ts.
  return reports.delete(id);
}

export function clearReports(): void {
  reports.clear();
}

export function reportCount(): number {
  return reports.size;
}
