/**
 * @forge/langgraph — Score-gated tool execution for LangGraph.
 *
 * Pattern derived from CREDITTIME (Qova) `@qova/langgraph` (MIT, Hausor Labs);
 * rewired from on-chain contract reads to the FORGE Agent Credit Bureau API.
 * Every score pull is a metered bureau inquiry ($2.80).
 *
 * Usage:
 *   const gate = new ForgeScoreGate({
 *     bureauUrl: 'https://bureau.forgepay.io',
 *     apiKey: process.env.FORGE_API_KEY!,
 *     minimumScore: 650,        // block agents below BB grade
 *   });
 *
 *   const graph = new StateGraph({ channels })
 *     .addNode('score_check', gate.checkNode())   // pulls the bureau score
 *     .addNode('execute_tool', toolNode)
 *     .addEdge('score_check', 'execute_tool')     // only reached if score passes
 *     .compile();
 */

export type GradeLetter =
  | 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'CC' | 'C' | 'D';

export interface ForgeScoreGateConfig {
  /** Base URL of the FORGE Agent Credit Bureau service. */
  bureauUrl: string;
  /** FORGE API key — inquiries are billed to this key at $2.80 per pull. */
  apiKey: string;
  /** Minimum 0–1000 score required to proceed. Default 650 (BB). */
  minimumScore?: number;
  /** Cache TTL for score reads, in ms. Default 30_000. */
  cacheTtlMs?: number;
}

export interface BureauScore {
  agentId: string;
  score: number;
  tier: string;
  grade?: { grade: GradeLetter; riskLevel: string; color: string };
  frozen: boolean;
}

export class ScoreGateError extends Error {
  constructor(
    message: string,
    readonly agentId: string,
    readonly score: number | null,
  ) {
    super(message);
    this.name = 'ScoreGateError';
  }
}

export class ForgeScoreGate {
  private readonly cache = new Map<string, { at: number; value: BureauScore }>();

  constructor(private readonly config: ForgeScoreGateConfig) {}

  /** Pull the agent's bureau score — a metered $2.80 inquiry (30s local cache). */
  async getScore(agentId: string): Promise<BureauScore> {
    const ttl = this.config.cacheTtlMs ?? 30_000;
    const hit = this.cache.get(agentId);
    if (hit && Date.now() - hit.at < ttl) return hit.value;

    const res = await fetch(
      `${this.config.bureauUrl}/v1/agents/${encodeURIComponent(agentId)}/score`,
      { headers: { authorization: `Bearer ${this.config.apiKey}` } },
    );
    if (!res.ok) {
      throw new ScoreGateError(`Bureau inquiry failed: HTTP ${res.status}`, agentId, null);
    }
    const body = (await res.json()) as { data: BureauScore };
    this.cache.set(agentId, { at: Date.now(), value: body.data });
    return body.data;
  }

  /**
   * A LangGraph-compatible node: reads `agentId` from graph state, pulls the
   * bureau score, and throws (halting the graph) if it's below threshold.
   */
  checkNode(): (state: { agentId: string } & Record<string, unknown>) => Promise<Record<string, unknown>> {
    const minimum = this.config.minimumScore ?? 650;
    return async (state) => {
      const result = await this.getScore(state.agentId);
      if (result.frozen) {
        throw new ScoreGateError(`Agent ${state.agentId} credit profile is frozen`, state.agentId, result.score);
      }
      if (result.score < minimum) {
        throw new ScoreGateError(
          `Agent ${state.agentId} score ${result.score} is below the ${minimum} gate` +
            (result.grade ? ` (grade ${result.grade.grade})` : ''),
          state.agentId,
          result.score,
        );
      }
      return { ...state, forgeScore: result.score, forgeGrade: result.grade?.grade ?? null };
    };
  }

  /** Record a tool outcome back into the agent's credit history. */
  async recordOutcome(
    agentId: string,
    outcome: { success: boolean; amountUsd?: number; description: string },
  ): Promise<void> {
    const res = await fetch(
      `${this.config.bureauUrl}/v1/agents/${encodeURIComponent(agentId)}/events`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          eventType: outcome.success ? 'payment_on_time' : 'payment_late_30',
          amount: outcome.amountUsd,
          description: outcome.description,
        }),
      },
    );
    if (!res.ok) {
      throw new ScoreGateError(`Failed to record outcome: HTTP ${res.status}`, agentId, null);
    }
  }
}
