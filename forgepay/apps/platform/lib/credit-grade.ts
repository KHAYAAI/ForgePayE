/**
 * AAA–D credit rating scale — console mirror of
 * forgepay/services/agent-credit-bureau/src/grade.ts.
 * Keep the two in sync; the live API also returns the grade with every score.
 */

export type GradeLetter =
  | 'AAA' | 'AA' | 'A'
  | 'BBB' | 'BB' | 'B'
  | 'CCC' | 'CC' | 'C'
  | 'D';

export interface GradeBand {
  min: number;
  max: number;
  grade: GradeLetter;
  riskLevel: string;
  meaning: string;
  investmentGrade: boolean;
}

export const GRADE_SCALE: GradeBand[] = [
  { min: 950, max: 1000, grade: 'AAA', riskLevel: 'Minimal',   meaning: 'Exceptional track record, highest trust', investmentGrade: true },
  { min: 900, max: 949,  grade: 'AA',  riskLevel: 'Very Low',  meaning: 'Excellent history, very reliable',        investmentGrade: true },
  { min: 850, max: 899,  grade: 'A',   riskLevel: 'Low',       meaning: 'Strong performance, trustworthy',         investmentGrade: true },
  { min: 750, max: 849,  grade: 'BBB', riskLevel: 'Moderate',  meaning: 'Good standing, investment grade',         investmentGrade: true },
  { min: 650, max: 749,  grade: 'BB',  riskLevel: 'Notable',   meaning: 'Fair record, room for improvement',       investmentGrade: false },
  { min: 550, max: 649,  grade: 'B',   riskLevel: 'Elevated',  meaning: 'Adequate but limited history',            investmentGrade: false },
  { min: 450, max: 549,  grade: 'CCC', riskLevel: 'High',      meaning: 'Below average, caution advised',          investmentGrade: false },
  { min: 350, max: 449,  grade: 'CC',  riskLevel: 'Very High', meaning: 'Poor record, significant risk',           investmentGrade: false },
  { min: 250, max: 349,  grade: 'C',   riskLevel: 'Severe',    meaning: 'Very poor, near default',                 investmentGrade: false },
  { min: 0,   max: 249,  grade: 'D',   riskLevel: 'Critical',  meaning: 'Default risk, avoid',                     investmentGrade: false },
];

export function gradeFor(score: number): GradeBand {
  const clamped = Math.max(0, Math.min(1000, Math.round(score)));
  return GRADE_SCALE.find(b => clamped >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1]!;
}

export function gradeTone(grade: GradeLetter): 'ok' | 'warn' | 'danger' | 'accent' {
  if (grade === 'AAA' || grade === 'AA' || grade === 'A') return 'ok';
  if (grade === 'BBB' || grade === 'BB') return 'accent';
  if (grade === 'B' || grade === 'CCC') return 'warn';
  return 'danger';
}

/** Per-inquiry bureau fee in USD. */
export const INQUIRY_FEE_USD = 2.8;
