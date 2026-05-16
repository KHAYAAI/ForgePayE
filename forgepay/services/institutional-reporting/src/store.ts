/**
 * In-memory report store.
 *
 * Keyed by UUIDv4. Holds both metadata (for list views) and the full payload.
 * In production: PostgreSQL with retention policies + S3 archival of large CSV
 * exports. Auditor read-only role enforced at the DB level.
 */

import { randomUUID } from 'node:crypto';
import type {
  ReportMetadata,
  ReportPayload,
  ReportType,
  ReportPeriod,
} from './types';

interface StoredReport {
  metadata: ReportMetadata;
  payload: ReportPayload;
}

const reports = new Map<string, StoredReport>();

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
  return reports.delete(id);
}

export function clearReports(): void {
  reports.clear();
}

export function reportCount(): number {
  return reports.size;
}
