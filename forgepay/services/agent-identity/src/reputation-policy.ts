/**
 * Who may say what about an agent's reputation.
 *
 * Reputation used to be whatever the agent's owner said it was: only the owning merchant could post events, and it could
 * post "transaction_success" or "vouched_by_trusted" about its own agent as often as it liked, so a score of 1000 cost one
 * loop. Lenders and the credit bureau read this score, so it must be harder to manufacture than to earn:
 *
 *   platform (admin key)   any event: these are FORGE's own services reporting what they observed (settlements, disputes)
 *   the owner              only NEGATIVE events about its own agent (failures, late payments, disputes raised). Honest
 *                          self-reporting of problems is allowed; self-praise is not.
 *   a counterparty         another merchant may report the outcome of a transaction it had with the agent (success, failure,
 *                          late payment, dispute raised), once per transaction id, and must name the transaction
 *   vouching               only from an agent the reporter owns, that is itself trusted or premium, and that is not owned
 *                          by the subject's owner; once per voucher per subject
 *   dispute_resolved,      platform only
 *   fraud_detected
 */
import type { AgentIdentity, ReputationEvent } from './types';

export interface Reporter { kind: 'admin' | 'merchant'; principalId: string }

const NEGATIVE: ReadonlySet<ReputationEvent['eventType']> = new Set(['transaction_failure', 'late_payment', 'dispute_raised']);
const COUNTERPARTY: ReadonlySet<ReputationEvent['eventType']> = new Set(['transaction_success', 'transaction_failure', 'late_payment', 'dispute_raised']);
const PLATFORM_ONLY: ReadonlySet<ReputationEvent['eventType']> = new Set(['dispute_resolved', 'fraud_detected']);

export function reputationEventRefusal(
  reporter: Reporter | undefined,
  subject: Pick<AgentIdentity, 'id' | 'ownerMerchantId'>,
  eventType: ReputationEvent['eventType'],
  opts: { transactionId?: string; relatedAgent?: Pick<AgentIdentity, 'id' | 'ownerMerchantId' | 'trustLevel' | 'status'> },
  prior: Pick<ReputationEvent, 'eventType' | 'transactionId' | 'relatedAgentId' | 'reportedBy'>[],
): string | null {
  if (!reporter) return 'authentication required';
  if (reporter.kind === 'admin') return null;
  if (PLATFORM_ONLY.has(eventType)) return `${eventType} can only be recorded by FORGE itself`;

  const isOwner = reporter.principalId === subject.ownerMerchantId;

  if (eventType === 'vouched_by_trusted') {
    const v = opts.relatedAgent;
    if (!v) return 'vouching needs relatedAgentId: the vouching agent, which you own';
    if (v.ownerMerchantId !== reporter.principalId) return 'you can only vouch with an agent you own';
    if (v.ownerMerchantId === subject.ownerMerchantId) return 'an owner cannot vouch for its own agents';
    if (v.id === subject.id) return 'an agent cannot vouch for itself';
    if (v.status !== 'active' || (v.trustLevel !== 'trusted' && v.trustLevel !== 'premium')) return 'only a trusted or premium agent can vouch';
    if (prior.some((e) => e.eventType === 'vouched_by_trusted' && e.relatedAgentId === v.id)) return 'this agent has already vouched for this agent';
    return null;
  }

  if (isOwner) {
    return NEGATIVE.has(eventType) ? null : `an owner may report problems with its own agent, not ${eventType}`;
  }

  if (!COUNTERPARTY.has(eventType)) return `${eventType} cannot be reported by a counterparty`;
  if (!opts.transactionId || !opts.transactionId.trim()) return 'a counterparty must name the transaction (transactionId)';
  const txKind = (t: string) => (t === 'dispute_raised' ? 'dispute' : 'outcome');
  if (prior.some((e) => e.transactionId === opts.transactionId && txKind(e.eventType) === txKind(eventType))) {
    return 'this transaction has already been reported';
  }
  return null;
}
