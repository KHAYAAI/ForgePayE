/**
 * ForgePay Agent Credit Bureau — Credit Rating Scale
 * ───────────────────────────────────────────────────
 * AAA–D letter grades on the 0–1000 score, absorbed from the CREDITTIME
 * (Qova) rating scale so FORGE scores read like a traditional bureau's.
 * See forgepay/config/base/pinned-upstreams.yaml → agent-credit-scoring.
 */

export type GradeLetter =
  | 'AAA' | 'AA' | 'A'
  | 'BBB' | 'BB' | 'B'
  | 'CCC' | 'CC' | 'C'
  | 'D';

export interface CreditGrade {
  grade: GradeLetter;
  riskLevel: string;
  meaning: string;
  color: string;         // hex, for badges / console pills
  investmentGrade: boolean;
}

interface GradeBand {
  min: number;
  grade: GradeLetter;
  riskLevel: string;
  meaning: string;
  color: string;
  investmentGrade: boolean;
}

export const GRADE_SCALE: GradeBand[] = [
  { min: 950, grade: 'AAA', riskLevel: 'Minimal',   meaning: 'Exceptional track record, highest trust',  color: '#15803D', investmentGrade: true },
  { min: 900, grade: 'AA',  riskLevel: 'Very Low',  meaning: 'Excellent history, very reliable',         color: '#16A34A', investmentGrade: true },
  { min: 850, grade: 'A',   riskLevel: 'Low',       meaning: 'Strong performance, trustworthy',          color: '#22C55E', investmentGrade: true },
  { min: 750, grade: 'BBB', riskLevel: 'Moderate',  meaning: 'Good standing, investment grade',          color: '#84CC16', investmentGrade: true },
  { min: 650, grade: 'BB',  riskLevel: 'Notable',   meaning: 'Fair record, room for improvement',        color: '#EAB308', investmentGrade: false },
  { min: 550, grade: 'B',   riskLevel: 'Elevated',  meaning: 'Adequate but limited history',             color: '#F59E0B', investmentGrade: false },
  { min: 450, grade: 'CCC', riskLevel: 'High',      meaning: 'Below average, caution advised',           color: '#F97316', investmentGrade: false },
  { min: 350, grade: 'CC',  riskLevel: 'Very High', meaning: 'Poor record, significant risk',            color: '#EF4444', investmentGrade: false },
  { min: 250, grade: 'C',   riskLevel: 'Severe',    meaning: 'Very poor, near default',                  color: '#DC2626', investmentGrade: false },
  { min: 0,   grade: 'D',   riskLevel: 'Critical',  meaning: 'Default risk, avoid',                      color: '#991B1B', investmentGrade: false },
];

export function creditGrade(score: number): CreditGrade {
  const clamped = Math.max(0, Math.min(1000, Math.round(score)));
  const band = GRADE_SCALE.find(b => clamped >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1]!;
  return {
    grade:           band.grade,
    riskLevel:       band.riskLevel,
    meaning:         band.meaning,
    color:           band.color,
    investmentGrade: band.investmentGrade,
  };
}

export function gradeDistribution(scores: number[]): Record<GradeLetter, number> {
  const dist = Object.fromEntries(GRADE_SCALE.map(b => [b.grade, 0])) as Record<GradeLetter, number>;
  for (const s of scores) dist[creditGrade(s).grade] += 1;
  return dist;
}

/** Per-inquiry bureau fee in USD — charged on every score pull, like a traditional bureau. */
export const INQUIRY_FEE_USD = 2.8;
