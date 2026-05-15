import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MOCK_DATA = {
  positions: [
    {
      id: 'pos_001',
      asset: 'Ondo USDY',
      units: 99500,
      invested_usd: 100000,
      current_value_usd: 100510,
      apy_bps: 520,
      accrued_income_usd: 510,
      status: 'active',
    },
    {
      id: 'pos_002',
      asset: 'Franklin FOBXX',
      units: 49800,
      invested_usd: 50000,
      current_value_usd: 50225,
      apy_bps: 480,
      accrued_income_usd: 225,
      status: 'active',
    },
  ],
  income_history: [
    {
      date: '2026-05-14',
      asset: 'Ondo USDY',
      amount_usd: 14.25,
      type: 'interest',
      tax_type: 'ordinary_income',
    },
    {
      date: '2026-05-13',
      asset: 'Franklin FOBXX',
      type: 'dividend',
      amount_usd: 6.60,
      tax_type: 'qualified_dividend',
    },
  ],
  tax_summary: {
    ordinary_income_usd: 3420,
    qualified_dividend_usd: 180,
    capital_gains_usd: 0,
  },
};

export async function GET(_req: NextRequest) {
  return NextResponse.json(MOCK_DATA);
}
