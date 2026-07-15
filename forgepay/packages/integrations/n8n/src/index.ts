/**
 * @forge/n8n — FORGE Agent Credit Bureau nodes for n8n.
 *
 * Node functions derived from CREDITTIME (Qova) `@qova/n8n` (MIT, Hausor
 * Labs); rewired from on-chain contract reads to the FORGE Agent Credit
 * Bureau API. Every score pull is a metered bureau inquiry ($2.80).
 *
 * Three action functions — wrap each in an n8n custom-node shell:
 *   forgeScoreCheck    → { score, grade, tier, frozen }  — branch with an IF node
 *   forgeVerifyAgent   → { status, checksPassed, checks } — 8-check verification
 *   forgeRecordOutcome → { newScore, tier }               — log an action for scoring
 */

export interface ForgeNodeCredentials {
  bureauUrl: string;
  apiKey: string;
}

async function bureau<T>(
  creds: ForgeNodeCredentials,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${creds.bureauUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${creds.apiKey}`,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`FORGE bureau ${path} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** Score Check node — one metered $2.80 inquiry. Connect to an IF node to branch by grade. */
export function forgeScoreCheck(creds: ForgeNodeCredentials, agentId: string) {
  return bureau<{
    agentId: string;
    score: number;
    tier: string;
    grade?: { grade: string; riskLevel: string; color: string };
    frozen: boolean;
  }>(creds, `/v1/agents/${encodeURIComponent(agentId)}/score`);
}

/** Verify Agent node — runs all 8 verification checks. */
export function forgeVerifyAgent(creds: ForgeNodeCredentials, agentId: string) {
  return bureau<{
    status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'SUSPICIOUS';
    checksPassed: number;
    checksTotal: number;
    checks: Array<{ check: string; passed: boolean; detail: string }>;
    grade: { grade: string };
  }>(creds, `/v1/agents/${encodeURIComponent(agentId)}/verify`, { method: 'POST' });
}

/** Record Outcome node — connect after any action node to log it for scoring. */
export function forgeRecordOutcome(
  creds: ForgeNodeCredentials,
  agentId: string,
  outcome: { success: boolean; amountUsd?: number; description: string },
) {
  return bureau<{ newScore: number; tier: string }>(
    creds,
    `/v1/agents/${encodeURIComponent(agentId)}/events`,
    {
      method: 'POST',
      body: {
        eventType: outcome.success ? 'payment_on_time' : 'payment_late_30',
        amount: outcome.amountUsd,
        description: outcome.description,
      },
    },
  );
}
