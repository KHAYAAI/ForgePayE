/**
 * Real identity verification, delegated to agent-identity.
 *
 * `verifyAgent()`'s `identity_bound` check never actually asked agent-identity
 * anything — it passed whenever the profile had a non-empty
 * `operatorEntityId` and a DID starting with `did:`, which is a shape check on
 * data the bureau itself already trusts, not evidence that the identity was
 * ever registered or is still active. `AGENT_IDENTITY_URL` was read and
 * echoed on `/health` and used nowhere else. If "identity-verified agents" is
 * part of the product's claim, this is where that verification has to
 * actually happen.
 *
 * Different fail-mode from sanctions.ts/COMPLIANCE_MONITOR_URL on purpose:
 * `AGENT_IDENTITY_URL` has always defaulted to `http://localhost:3010`
 * rather than being unset by default, so there is no "unconfigured" state to
 * gate on the way there is for compliance-monitor — only "reachable" or not.
 * And identity_bound is one signal among eight feeding a soft verification
 * status, not a hard release gate like a sanctions hit, so an unreachable
 * agent-identity degrades to the pre-existing local heuristic rather than
 * failing the whole verify() call closed.
 */

import { parseDid } from './did';

export interface AgentIdentityRecord {
  id: string;
  did: string;
  status: 'active' | 'suspended' | 'deregistered';
}

export type IdentityCheckOutcome =
  | { checked: true; found: true; active: boolean; record: AgentIdentityRecord }
  | { checked: true; found: false }
  | { checked: false; reason: 'not_registry_form' | 'call_failed' };

function baseUrl(): string {
  return (process.env['AGENT_IDENTITY_URL'] ?? 'http://localhost:3010').replace(/\/$/, '');
}

/**
 * Confirm a DID against agent-identity's own registry.
 *
 * Only registry-form DIDs (`did:forge:agent_<id>`, minted by agent-identity)
 * have anything to look up — address-form DIDs are wallet-bound and never
 * registered there, so those return `not_registry_form` without a call.
 */
export async function checkAgentIdentity(did: string): Promise<IdentityCheckOutcome> {
  const parsed = parseDid(did);
  if (!parsed || parsed.form !== 'registry') {
    return { checked: false, reason: 'not_registry_form' };
  }

  try {
    const res = await fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(parsed.id)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return { checked: true, found: false };
    if (!res.ok) {
      console.error('[bureau] agent-identity lookup returned non-2xx', { did, status: res.status });
      return { checked: false, reason: 'call_failed' };
    }
    const body = (await res.json()) as { data: AgentIdentityRecord };
    return { checked: true, found: true, active: body.data.status === 'active', record: body.data };
  } catch (err) {
    console.error('[bureau] agent-identity lookup call failed', { err, did });
    return { checked: false, reason: 'call_failed' };
  }
}
