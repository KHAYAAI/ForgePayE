/**
 * Tax Filing Packet Generator
 *
 * Not available. This used to return form lines (1099-INT, 8949, CT600, VAT
 * MOSS, IRAS Form C, BAS, …) "shaped for direct submission" whose amounts
 * were $1,000 per day of the period multiplied by a tax rate — numbers with
 * no connection to any customer's revenue, gains or tax. A filing packet
 * needs the customer's actual sales-tax and revenue records (mor-layer) and a
 * tax professional's review; until that source is connected, no packet is
 * produced and the response says why.
 */

import type { Jurisdiction, TaxFilingPacket, ReportPeriod } from '../types';

export const TAX_FILING_UNAVAILABLE =
  'Tax filing packets are not produced: no source of taxable amounts is connected. ' +
  'Earlier versions returned placeholder figures ($1,000/day × a tax rate); those were not real and must not be filed.';

export function generateTaxFilingPacket(
  jurisdiction: Jurisdiction,
  period: ReportPeriod,
): TaxFilingPacket {
  return {
    jurisdiction,
    period,
    lines: [],
    available: false,
    reason: TAX_FILING_UNAVAILABLE,
    generatedAt: new Date().toISOString(),
  };
}
