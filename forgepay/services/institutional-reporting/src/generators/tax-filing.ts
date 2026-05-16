/**
 * Tax Filing Packet Generator
 *
 * Returns jurisdiction-specific line items shaped for direct submission to
 * the relevant tax authority's filing form. Amounts here are derived from a
 * $1,000/day base × period length heuristic — in production the mor-layer
 * sales-tax and revenue tables drive these values.
 *
 * Supported jurisdictions:
 *   US  →  1099-INT (yield income), Form 8949 (capital gains), W-9 (entity)
 *   UK  →  VAT Return, CT600 (corporation tax)
 *   EU  →  VAT MOSS (cross-border digital services)
 *   SG  →  IRAS Form C (corporate income tax), GST return
 *   AU  →  BAS (Business Activity Statement)
 */

import type {
  Jurisdiction,
  TaxFilingPacket,
  TaxFilingLine,
  ReportPeriod,
} from '../types';

const DAILY_BASE_USD = 1000;

function periodDays(period: ReportPeriod): number {
  const ms = new Date(period.end).getTime() - new Date(period.start).getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function generateTaxFilingPacket(
  jurisdiction: Jurisdiction,
  period: ReportPeriod,
): TaxFilingPacket {
  const days  = periodDays(period);
  const base  = DAILY_BASE_USD * days;
  const lines: TaxFilingLine[] = [];

  switch (jurisdiction) {
    case 'US':
      lines.push(
        { lineCode: '1099-INT',  description: 'Interest income from yield vaults',  amountUsd: r2(base * 0.04) },
        { lineCode: '8949',      description: 'Capital gains from token disposals', amountUsd: r2(base * 0.02) },
        { lineCode: 'W-9',       description: 'Entity tax classification stub',     amountUsd: 0 },
        { lineCode: '1040',      description: 'Pass-through income aggregate',      amountUsd: r2(base * 0.10) },
      );
      break;
    case 'UK':
      lines.push(
        { lineCode: 'VAT-RETURN-T1', description: 'Output VAT on sales (20%)',  amountUsd: r2(base * 0.20) },
        { lineCode: 'VAT-RETURN-T4', description: 'Input VAT reclaimable',      amountUsd: r2(base * 0.05) },
        { lineCode: 'CT600',         description: 'Corporation tax (19%)',      amountUsd: r2(base * 0.19) },
      );
      break;
    case 'EU':
      lines.push(
        { lineCode: 'VAT-MOSS-DE', description: 'Cross-border digital services VAT (DE 19%)', amountUsd: r2(base * 0.19) },
        { lineCode: 'VAT-MOSS-FR', description: 'Cross-border digital services VAT (FR 20%)', amountUsd: r2(base * 0.20) },
        { lineCode: 'VAT-MOSS-NL', description: 'Cross-border digital services VAT (NL 21%)', amountUsd: r2(base * 0.21) },
      );
      break;
    case 'SG':
      lines.push(
        { lineCode: 'IRAS-FORM-C', description: 'Corporate income tax (17%)', amountUsd: r2(base * 0.17) },
        { lineCode: 'GST-F5',      description: 'Goods & Services Tax (9%)',  amountUsd: r2(base * 0.09) },
      );
      break;
    case 'AU':
      lines.push(
        { lineCode: 'BAS-G1', description: 'Total sales reported',              amountUsd: r2(base)        },
        { lineCode: 'BAS-1A', description: 'GST on sales (10%)',                amountUsd: r2(base * 0.10) },
        { lineCode: 'BAS-1B', description: 'GST on purchases (input credits)', amountUsd: r2(base * 0.03) },
        { lineCode: 'BAS-7',  description: 'Deferred company instalment',      amountUsd: r2(base * 0.30) },
      );
      break;
    default: {
      const _exhaustive: never = jurisdiction;
      void _exhaustive;
    }
  }

  return {
    jurisdiction,
    period,
    lines,
    generatedAt: new Date().toISOString(),
  };
}
