/**
 * Onboarding Analytics & Funnel Monitoring
 *
 * Mitigates: "Onboarding completion <50%" (High Risk)
 *
 * Tracks:
 * - Sign-up → Step 1 → Step 2 → ... → Completion
 * - Abandonment rate per step
 * - Fallback flow activation
 */

import { db } from '../db';

interface OnboardingStep {
  product: 'payments' | 'treasury' | 'credit-bureau';
  stepNumber: number;
  stepName: string;
  completionTimeMs: number;
  abandoned: boolean;
}

interface OnboardingFunnel {
  product: string;
  totalSignups: number;
  step1Completed: number;
  step2Completed: number;
  step3Completed: number;
  step4Completed: number;
  step5Completed: number;
  step6Completed: number;
  completionRate: number;
  avgTimeToCompletion: number;
}

const FUNNELS: Map<string, OnboardingFunnel> = new Map();

export async function trackOnboardingStep(
  customerId: string,
  product: 'payments' | 'treasury' | 'credit-bureau',
  stepNumber: number,
  completed: boolean,
  timeMs: number
): Promise<void> {
  const funnelKey = product;
  const funnel = FUNNELS.get(funnelKey) || initializeFunnel(product);

  if (stepNumber === 1) {
    funnel.totalSignups++;
  }

  if (completed) {
    if (stepNumber === 1) funnel.step1Completed++;
    else if (stepNumber === 2) funnel.step2Completed++;
    else if (stepNumber === 3) funnel.step3Completed++;
    else if (stepNumber === 4) funnel.step4Completed++;
    else if (stepNumber === 5) funnel.step5Completed++;
    else if (stepNumber === 6) funnel.step6Completed++;
  }

  // Update completion rate
  const stepsPerProduct = product === 'payments' ? 6 : product === 'treasury' ? 5 : 4;
  const completedByProduct = [
    funnel.step1Completed,
    funnel.step2Completed,
    funnel.step3Completed,
    funnel.step4Completed,
    funnel.step5Completed,
    funnel.step6Completed,
  ].slice(0, stepsPerProduct);
  funnel.completionRate = funnel.totalSignups > 0 ? (completedByProduct[stepsPerProduct - 1] / funnel.totalSignups) * 100 : 0;

  FUNNELS.set(funnelKey, funnel);

  // Alert if completion <50%
  if (funnel.completionRate < 50 && funnel.totalSignups > 20) {
    console.warn(`[Onboarding Monitor] ALERT: ${product} completion rate ${funnel.completionRate.toFixed(1)}% (<50%)`);
    await activateFallbackFlow(product);
  }

  // Log to database
  await db.query(
    'public',
    `
      INSERT INTO onboarding_events 
      (customer_id, product, step_number, completed, duration_ms, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [customerId, product, stepNumber, completed, timeMs]
  );
}

export function getFunnel(product?: string): OnboardingFunnel | Map<string, OnboardingFunnel> {
  if (product) {
    return FUNNELS.get(product) || initializeFunnel(product as any);
  }
  return FUNNELS;
}

function initializeFunnel(product: string): OnboardingFunnel {
  return {
    product,
    totalSignups: 0,
    step1Completed: 0,
    step2Completed: 0,
    step3Completed: 0,
    step4Completed: 0,
    step5Completed: 0,
    step6Completed: 0,
    completionRate: 0,
    avgTimeToCompletion: 0,
  };
}

/**
 * Fallback flow activation
 *
 * If onboarding completion <50%, activate simplified flow:
 * 1. Email: "Need help with onboarding? CSM can do it for you"
 * 2. Video tutorials: Embedded in onboarding flow
 * 3. Live chat: Enable Intercom for real-time help
 * 4. CSM call: Offer 15-min guided walkthrough
 */
async function activateFallbackFlow(product: string): Promise<void> {
  console.warn(`[Onboarding Monitor] Activating fallback flow for ${product}`);

  // Email all customers stuck on step 1
  const stuckCustomers = await db.query(
    'public',
    `
      SELECT DISTINCT oe1.customer_id
      FROM onboarding_events oe1
      WHERE oe1.product = $1
        AND oe1.step_number = 1
        AND oe1.completed = true
        AND NOT EXISTS (
          SELECT 1 FROM onboarding_events oe2
          WHERE oe2.customer_id = oe1.customer_id
            AND oe2.product = $1
            AND oe2.step_number = 2
        )
    `,
    [product]
  );

  console.info(`[Onboarding Monitor] Found ${stuckCustomers.rowCount} customers stuck on step 1`);

  // TODO: Send "Need help?" email to each
  // TODO: Enable Intercom live chat widget
  // TODO: Create reminder: "CSM can help complete setup" (Day 3 if not completed)
}

/**
 * A/B test onboarding flow
 *
 * Tests: simplified flow (3 steps) vs current flow
 * Tracks: completion rate, time to completion
 */
export async function createOnboardingABTest(product: string, variantA: string, variantB: string): Promise<void> {
  console.info(`[Onboarding Monitor] Starting A/B test for ${product}: ${variantA} vs ${variantB}`);

  // TODO: Randomly assign 50% of users to each variant
  // TODO: Track completion rate per variant
  // TODO: After 100 sign-ups, analyze winner and deploy to 100%
}

/**
 * Migration to create analytics table
 */
export const ONBOARDING_ANALYTICS_MIGRATION = `
CREATE TABLE IF NOT EXISTS onboarding_events (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL,
  product VARCHAR(50) NOT NULL,
  step_number INT NOT NULL,
  completed BOOLEAN NOT NULL,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_customer_product (customer_id, product),
  INDEX idx_product_step (product, step_number)
);
`;
