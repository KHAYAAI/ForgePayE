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
export declare function registerSettlementRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=settlement.d.ts.map