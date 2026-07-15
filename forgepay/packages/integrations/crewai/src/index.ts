/**
 * @forge/crewai — Trust-based task delegation for CrewAI.
 *
 * Pattern derived from CREDITTIME (Qova) `@qova/crewai` (MIT, Hausor Labs);
 * rewired from on-chain contract reads to the FORGE Agent Credit Bureau API.
 * Every score pull is a metered bureau inquiry ($2.80).
 *
 * Usage:
 *   const delegation = new ForgeTrustDelegation({
 *     bureauUrl: 'https://bureau.forgepay.io',
 *     apiKey: process.env.FORGE_API_KEY!,
 *     scoreThresholds: { highValue: 800, standard: 650, lowValue: 450 },
 *   });
 *   const agentId = await delegation.assignTask({ valueTier: 'highValue' }, candidates);
 */

export type TaskValueTier = 'highValue' | 'standard' | 'lowValue';

export interface ForgeTrustDelegationConfig {
  bureauUrl: string;
  apiKey: string;
  /** Minimum 0–1000 score per task tier. Defaults: 800 / 650 / 450. */
  scoreThresholds?: Partial<Record<TaskValueTier, number>>;
  cacheTtlMs?: number;
}

export interface DelegationTask {
  valueTier: TaskValueTier;
  description?: string;
}

export interface ScoredCandidate {
  agentId: string;
  score: number;
  grade: string | null;
  eligible: boolean;
}

export interface DelegationResult {
  assignedAgentId: string;
  threshold: number;
  candidates: ScoredCandidate[];
}

const DEFAULT_THRESHOLDS: Record<TaskValueTier, number> = {
  highValue: 800,   // A grade and above
  standard:  650,   // BB and above
  lowValue:  450,   // CCC and above
};

export class DelegationError extends Error {
  constructor(message: string, readonly candidates: ScoredCandidate[]) {
    super(message);
    this.name = 'DelegationError';
  }
}

export class ForgeTrustDelegation {
  private readonly cache = new Map<string, { at: number; score: number; grade: string | null; frozen: boolean }>();

  constructor(private readonly config: ForgeTrustDelegationConfig) {}

  private async pull(agentId: string) {
    const ttl = this.config.cacheTtlMs ?? 30_000;
    const hit = this.cache.get(agentId);
    if (hit && Date.now() - hit.at < ttl) return hit;

    const res = await fetch(
      `${this.config.bureauUrl}/v1/agents/${encodeURIComponent(agentId)}/score`,
      { headers: { authorization: `Bearer ${this.config.apiKey}` } },
    );
    if (!res.ok) throw new Error(`Bureau inquiry failed for ${agentId}: HTTP ${res.status}`);
    const body = (await res.json()) as {
      data: { score: number; grade?: { grade: string }; frozen: boolean };
    };
    const entry = {
      at: Date.now(),
      score: body.data.score,
      grade: body.data.grade?.grade ?? null,
      frozen: body.data.frozen,
    };
    this.cache.set(agentId, entry);
    return entry;
  }

  /**
   * Pull each candidate's bureau score (one metered inquiry per uncached
   * candidate), filter to those meeting the task tier's threshold, and
   * return the highest-scored eligible agent.
   */
  async assignTask(task: DelegationTask, candidateAgentIds: string[]): Promise<DelegationResult> {
    const threshold =
      this.config.scoreThresholds?.[task.valueTier] ?? DEFAULT_THRESHOLDS[task.valueTier];

    const candidates: ScoredCandidate[] = await Promise.all(
      candidateAgentIds.map(async (agentId) => {
        const s = await this.pull(agentId);
        return {
          agentId,
          score: s.score,
          grade: s.grade,
          eligible: !s.frozen && s.score >= threshold,
        };
      }),
    );

    const eligible = candidates
      .filter(c => c.eligible)
      .sort((a, b) => b.score - a.score);

    if (eligible.length === 0) {
      throw new DelegationError(
        `No candidate meets the ${task.valueTier} threshold of ${threshold}`,
        candidates,
      );
    }

    return { assignedAgentId: eligible[0]!.agentId, threshold, candidates };
  }
}
