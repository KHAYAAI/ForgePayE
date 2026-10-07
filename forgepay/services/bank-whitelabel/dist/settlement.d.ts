/**
 * Settlement Report Generation
 *
 * Generates daily/weekly settlement reports per bank.
 * Reports include all confirmed transactions, aggregate fee totals,
 * and the net amount owed to the bank.
 */
import { BankTransaction, SettlementReport, Bank } from './types.js';
export declare function generateSettlementReport(bank: Bank, transactions: BankTransaction[], date: string): SettlementReport;
export declare function toCSV(report: SettlementReport): string;
/**
 * Returns the start and end of a given date string (YYYY-MM-DD) as UTC Date objects.
 */
export declare function dateRange(dateStr: string): {
    from: Date;
    to: Date;
};
/**
 * Returns today's date as a YYYY-MM-DD string in UTC.
 */
export declare function todayUTC(): string;
//# sourceMappingURL=settlement.d.ts.map