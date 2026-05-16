/**
 * ForgePay Institutional Reporting Service
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: CFO/auditor-ready financial reports — cash flow, yield income, netting,
 *       SOX audit trails, multi-jurisdiction tax filing packets.
 *
 * Features:
 *   1. Report generation on-demand (POST /v1/reports)
 *   2. Report retrieval and listing (GET /v1/reports)
 *   3. CSV export of any saved report
 *   4. Tax filing packets per jurisdiction
 *   5. Agent tool manifest for ForgePay autonomous agents
 *
 * Port: 3017
 *
 * Env vars:
 *   TREASURY_URL            — default http://localhost:3012
 *   YIELD_ENGINE_URL        — default http://localhost:3007
 *   BANK_WHITELABEL_URL     — default http://localhost:3015
 *   CORS_ORIGIN             — default *
 *   RATE_LIMIT_PER_MIN      — default 60
 *   LOG_LEVEL               — default info
 */

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { z } from 'zod';

import { generateCashFlowReport }    from './generators/cash-flow';
import { generateYieldIncomeReport } from './generators/yield-income';
import { generateNettingReport }     from './generators/netting';
import { generateAuditTrailReport }  from './generators/audit-trail';
import { generateTaxFilingPacket }   from './generators/tax-filing';
import { toCsv }                     from './csv';
import {
  saveReport,
  getReport,
  listReports,
  deleteReport,
  clearReports,
  reportCount,
} from './store';
import type { Jurisdiction, ReportType, CashFlowReport, NettingReport, AuditTrailReport, YieldIncomeReport } from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT                = parseInt(process.env['PORT'] ?? '3017', 10);
const TREASURY_URL        = process.env['TREASURY_URL'] ?? 'http://localhost:3012';
const YIELD_ENGINE_URL    = process.env['YIELD_ENGINE_URL'] ?? 'http://localhost:3007';
const BANK_WHITELABEL_URL = process.env['BANK_WHITELABEL_URL'] ?? 'http://localhost:3015';
const RATE_LIMIT_PER_MIN  = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '60', 10);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ReportTypeSchema = z.enum([
  'cash_flow', 'yield_income', 'netting', 'audit_trail', 'tax_filing',
] satisfies [ReportType, ...ReportType[]]);

const JurisdictionSchema = z.enum(['US', 'UK', 'EU', 'SG', 'AU'] satisfies [Jurisdiction, ...Jurisdiction[]]);

const GenerateReportSchema = z.object({
  type:        ReportTypeSchema,
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  periodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  enterpriseId: z.string().min(1).optional().default('default'),
  jurisdiction: JurisdictionSchema.optional(),
  correlationId: z.string().optional(),
});

// ── App ───────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
const app = Fastify({
  logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
});

await app.register(helmet);
await app.register(cors, { origin: process.env['CORS_ORIGIN'] ?? '*' });
await app.register(rateLimit, { max: RATE_LIMIT_PER_MIN, timeWindow: '1 minute' });

// ── Error handler ─────────────────────────────────────────────────────────────

app.setErrorHandler<FastifyError>((error, _req, reply) => {
  const status = error.statusCode ?? 500;
  const message = status < 500 ? error.message : 'Internal server error';
  reply.status(status).send({ error: message });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, reply) => {
  reply.send({
    status: 'ok',
    service: 'institutional-reporting',
    version: '0.1.0',
    reportCount: reportCount(),
    upstreams: {
      treasury: TREASURY_URL,
      yieldEngine: YIELD_ENGINE_URL,
      bankWhitelabel: BANK_WHITELABEL_URL,
    },
  });
});

// ── Report generation (POST /v1/reports) ──────────────────────────────────────

app.post('/v1/reports', async (req, reply) => {
  const body = GenerateReportSchema.safeParse(req.body);
  if (!body.success) {
    return reply.status(400).send({ error: 'Validation error', issues: body.error.flatten() });
  }

  const { type, periodStart, periodEnd, enterpriseId, jurisdiction, correlationId } = body.data;
  const period = { start: periodStart, end: periodEnd };

  let payload;
  switch (type) {
    case 'cash_flow':
      payload = await generateCashFlowReport({
        enterpriseId,
        periodStart,
        periodEnd,
        treasuryBaseUrl: TREASURY_URL,
      });
      break;

    case 'yield_income':
      payload = await generateYieldIncomeReport({
        periodStart,
        periodEnd,
        yieldEngineBaseUrl: YIELD_ENGINE_URL,
      });
      break;

    case 'netting':
      payload = await generateNettingReport({
        periodStart,
        periodEnd,
        treasuryBaseUrl: TREASURY_URL,
      });
      break;

    case 'audit_trail':
      payload = await generateAuditTrailReport({
        periodStart,
        periodEnd,
        bankWhitelabelBaseUrl: BANK_WHITELABEL_URL,
      });
      break;

    case 'tax_filing': {
      if (!jurisdiction) {
        return reply.status(400).send({ error: 'jurisdiction is required for tax_filing reports' });
      }
      const packet = generateTaxFilingPacket(jurisdiction, period);
      const meta = saveReport(type, period, packet, correlationId);
      return reply.status(201).send({ data: packet, meta });
    }

    default:
      return reply.status(400).send({ error: `Unknown report type: ${type}` });
  }

  const meta = saveReport(type, period, payload, correlationId);
  reply.status(201).send({ data: payload, meta });
});

// ── Report listing and retrieval ──────────────────────────────────────────────

app.get('/v1/reports', async (_req, reply) => {
  reply.send({ data: listReports() });
});

app.get('/v1/reports/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const stored = getReport(id);
  if (!stored) return reply.status(404).send({ error: 'Report not found' });
  reply.send({ data: stored.payload, meta: stored.metadata });
});

app.delete('/v1/reports/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const deleted = deleteReport(id);
  if (!deleted) return reply.status(404).send({ error: 'Report not found' });
  reply.status(204).send();
});

// ── CSV export ────────────────────────────────────────────────────────────────

app.get('/v1/reports/:id/csv', async (req, reply) => {
  const { id } = req.params as { id: string };
  const stored = getReport(id);
  if (!stored) return reply.status(404).send({ error: 'Report not found' });

  const { metadata, payload } = stored;
  let rows: Record<string, string | number | boolean | null | undefined>[] = [];
  let filename = `report-${id}`;

  switch (metadata.type) {
    case 'cash_flow': {
      const r = payload as CashFlowReport;
      rows = r.lineItems.map(li => ({
        date: li.date,
        category: li.category,
        description: li.description,
        amountUsd: li.amountUsd,
      }));
      filename = `cash-flow-${metadata.period.start}-${metadata.period.end}`;
      break;
    }
    case 'netting': {
      const r = payload as NettingReport;
      rows = r.byPair.map(p => ({
        fromSubsidiary: p.fromSubsidiary,
        toSubsidiary:   p.toSubsidiary,
        grossUsd:       p.grossUsd,
        netUsd:         p.netUsd,
        feesAvoidedUsd: p.feesAvoidedUsd,
      }));
      filename = `netting-${metadata.period.start}-${metadata.period.end}`;
      break;
    }
    case 'audit_trail': {
      const r = payload as AuditTrailReport;
      rows = r.criticalEvents.map(ev => ({
        id:        ev.id ?? '',
        timestamp: ev.timestamp,
        actor:     ev.actor,
        action:    ev.action,
        resource:  ev.resource ?? '',
      }));
      filename = `audit-trail-${metadata.period.start}-${metadata.period.end}`;
      break;
    }
    case 'yield_income': {
      const r = payload as YieldIncomeReport;
      rows = Object.entries(r.byVault).map(([vault, v]) => ({
        vault,
        principalUsd: v.principalUsd,
        yieldUsd:     v.yieldUsd,
        apyAvg:       v.apyAvg,
      }));
      filename = `yield-income-${metadata.period.start}-${metadata.period.end}`;
      break;
    }
    default:
      return reply.status(422).send({ error: 'CSV export not supported for this report type' });
  }

  const csv = toCsv(rows);
  reply
    .header('Content-Type', 'text/csv')
    .header('Content-Disposition', `attachment; filename="${filename}.csv"`)
    .send(csv);
});

// ── Tax filing endpoint (convenience, not stored) ─────────────────────────────

app.get('/v1/tax-filing', async (req, reply) => {
  const query = req.query as { jurisdiction?: string; periodStart?: string; periodEnd?: string };

  const jResult = JurisdictionSchema.safeParse(query.jurisdiction);
  if (!jResult.success) {
    return reply.status(400).send({ error: 'jurisdiction must be one of US, UK, EU, SG, AU' });
  }

  const start = query.periodStart ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const end   = query.periodEnd   ?? new Date().toISOString().slice(0, 10);

  const packet = generateTaxFilingPacket(jResult.data, { start, end });
  reply.send({ data: packet });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

app.delete('/v1/reports', async (_req, reply) => {
  clearReports();
  reply.send({ cleared: true });
});

// ── Agent tool manifest ───────────────────────────────────────────────────────

app.get('/v1/agent/tools', async (_req, reply) => {
  reply.send({
    service: 'institutional-reporting',
    version: '0.1.0',
    tools: [
      {
        name: 'generate_report',
        description: 'Generate a financial report (cash_flow, yield_income, netting, audit_trail, tax_filing)',
        method: 'POST',
        path: '/v1/reports',
        parameters: ['type', 'periodStart', 'periodEnd', 'enterpriseId?', 'jurisdiction?'],
      },
      {
        name: 'list_reports',
        description: 'List all previously generated reports sorted newest first',
        method: 'GET',
        path: '/v1/reports',
      },
      {
        name: 'get_report',
        description: 'Retrieve a specific report by ID with full payload',
        method: 'GET',
        path: '/v1/reports/:id',
      },
      {
        name: 'export_csv',
        description: 'Export a report as CSV download (cash_flow, netting, audit_trail, yield_income)',
        method: 'GET',
        path: '/v1/reports/:id/csv',
      },
      {
        name: 'tax_filing_packet',
        description: 'Get tax filing line items for a jurisdiction without saving',
        method: 'GET',
        path: '/v1/tax-filing?jurisdiction=US&periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD',
      },
    ],
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
┌─────────────────────────────────────────────────────────┐
│          ForgePay Institutional Reporting v0.1.0         │
├─────────────────────────────────────────────────────────┤
│  Port     : ${PORT}                                         │
│  Endpoints:                                              │
│    POST /v1/reports           generate report            │
│    GET  /v1/reports           list reports               │
│    GET  /v1/reports/:id       get report                 │
│    GET  /v1/reports/:id/csv   CSV export                 │
│    GET  /v1/tax-filing        tax filing packet          │
│    GET  /v1/agent/tools       agent manifest             │
│    GET  /health               health check               │
└─────────────────────────────────────────────────────────┘
`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
