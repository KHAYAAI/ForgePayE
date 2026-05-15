/**
 * Settlement Report Generation
 *
 * Generates daily/weekly settlement reports per bank.
 * Reports include all confirmed transactions, aggregate fee totals,
 * and the net amount owed to the bank.
 */

import { BankTransaction, SettlementReport, Bank } from './types.js';

export function generateSettlementReport(
  bank: Bank,
  transactions: BankTransaction[],
  date: string,
): SettlementReport {
  // Only include transactions that are confirmed or refunded for settlement
  const settled = transactions.filter(
    (t) => t.status === 'confirmed' || t.status === 'refunded',
  );

  const totalVolumeUsd = settled.reduce((sum, t) => sum + t.amountUsd, 0);
  const totalFeesUsd   = settled.reduce((sum, t) => sum + t.feeUsd, 0);

  return {
    bankId:           bank.id,
    bankName:         bank.name,
    reportDate:       date,
    currency:         bank.settlementCurrency,
    totalTransactions: settled.length,
    totalVolumeUsd:   round2(totalVolumeUsd),
    totalFeesUsd:     round2(totalFeesUsd),
    netSettlementUsd: round2(totalVolumeUsd - totalFeesUsd),
    transactions:     settled,
    generatedAt:      new Date().toISOString(),
  };
}

export function toCSV(report: SettlementReport): string {
  const lines: string[] = [
    // Report header metadata
    `# ForgePay Settlement Report`,
    `# Bank: ${report.bankName} (${report.bankId})`,
    `# Report Date: ${report.reportDate}`,
    `# Currency: ${report.currency}`,
    `# Total Transactions: ${report.totalTransactions}`,
    `# Total Volume USD: ${report.totalVolumeUsd}`,
    `# Total Fees USD: ${report.totalFeesUsd}`,
    `# Net Settlement USD: ${report.netSettlementUsd}`,
    `# Generated At: ${report.generatedAt}`,
    ``,
    // Column headers
    `id,customerId,type,asset,amountCrypto,amountUsd,feeUsd,netAmountUsd,status,txHash,createdAt,confirmedAt`,
  ];

  for (const t of report.transactions) {
    lines.push(
      [
        t.id,
        t.customerId,
        t.type,
        t.asset,
        t.amountCrypto,
        t.amountUsd,
        t.feeUsd,
        t.netAmountUsd,
        t.status,
        t.txHash ?? '',
        t.createdAt,
        t.confirmedAt ?? '',
      ].join(','),
    );
  }

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Returns the start and end of a given date string (YYYY-MM-DD) as UTC Date objects.
 */
export function dateRange(dateStr: string): { from: Date; to: Date } {
  const from = new Date(`${dateStr}T00:00:00.000Z`);
  const to   = new Date(`${dateStr}T23:59:59.999Z`);
  return { from, to };
}

/**
 * Returns today's date as a YYYY-MM-DD string in UTC.
 */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
