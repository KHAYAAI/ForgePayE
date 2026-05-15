/**
 * Settlement Reconciliation Routes
 *
 * Generates daily/weekly settlement reports for a bank.
 * Reports are scoped to the authenticated bank — no cross-bank data leakage.
 *
 * Routes:
 *   GET /v1/settlement/report        — today's settlement report (JSON)
 *   GET /v1/settlement/report.csv    — today's settlement report (CSV)
 *   GET /v1/settlement/history       — metadata for past N days of reports
 */

import type { FastifyInstance } from 'fastify';
import { Transactions, Banks } from '../store.js';
import { authenticate, extractBankId } from '../auth.js';
import { generateSettlementReport, toCSV, dateRange, todayUTC } from '../settlement.js';

export async function registerSettlementRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /v1/settlement/report — JSON report for a given date ─────────────
  app.get<{
    Querystring: { date?: string };
  }>(
    '/v1/settlement/report',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const bankId = extractBankId(request);
      const bank   = Banks.findById(bankId);
      if (!bank) return reply.status(404).send({ error: 'Bank not found' });

      const date = request.query.date ?? todayUTC();

      const { from, to } = dateRange(date);
      const txns = Transactions.findByBankAndDateRange(bankId, from, to);
      const report = generateSettlementReport(bank, txns, date);

      return reply.send(report);
    },
  );

  // ── GET /v1/settlement/report.csv — CSV download for a given date ─────────
  app.get<{
    Querystring: { date?: string };
  }>(
    '/v1/settlement/report.csv',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const bankId = extractBankId(request);
      const bank   = Banks.findById(bankId);
      if (!bank) return reply.status(404).send({ error: 'Bank not found' });

      const date = request.query.date ?? todayUTC();
      const filename = `forgepay-settlement-${bank.slug}-${date}.csv`;

      const { from, to } = dateRange(date);
      const txns   = Transactions.findByBankAndDateRange(bankId, from, to);
      const report = generateSettlementReport(bank, txns, date);
      const csv    = toCSV(report);

      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    },
  );

  // ── GET /v1/settlement/history — past N days of report metadata ───────────
  app.get<{
    Querystring: { days?: string };
  }>(
    '/v1/settlement/history',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const bankId = extractBankId(request);
      const bank   = Banks.findById(bankId);
      if (!bank) return reply.status(404).send({ error: 'Bank not found' });

      const days = Math.min(parseInt(request.query.days ?? '30', 10), 90);
      const history: Array<{
        date: string;
        totalTransactions: number;
        totalVolumeUsd: number;
        totalFeesUsd: number;
        netSettlementUsd: number;
      }> = [];

      const today = new Date();

      for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = d.toISOString().slice(0, 10);

        const { from, to } = dateRange(dateStr);
        const txns   = Transactions.findByBankAndDateRange(bankId, from, to);
        const report = generateSettlementReport(bank, txns, dateStr);

        history.push({
          date:              report.reportDate,
          totalTransactions: report.totalTransactions,
          totalVolumeUsd:    report.totalVolumeUsd,
          totalFeesUsd:      report.totalFeesUsd,
          netSettlementUsd:  report.netSettlementUsd,
        });
      }

      return reply.send({
        bankId,
        bankName: bank.name,
        currency: bank.settlementCurrency,
        days,
        history,
      });
    },
  );
}
