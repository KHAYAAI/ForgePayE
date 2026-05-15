export type NegotiationStatus = 'pending' | 'active' | 'accepted' | 'rejected' | 'expired' | 'settled' | 'disputed';
export type EscrowStatus = 'pending' | 'funded' | 'released' | 'refunded' | 'disputed';
export type MessageRole = 'offer' | 'counter_offer' | 'accept' | 'reject' | 'cancel' | 'settle';

export interface NegotiationTerm {
  key: string;    // e.g. 'price_usd', 'delivery_sla_hours', 'data_format', 'retry_policy'
  value: string | number | boolean;
  unit?: string;  // e.g. 'USD', 'hours', 'MB'
}

export interface NegotiationMessage {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId: string;
  role: MessageRole;
  terms: NegotiationTerm[];
  message?: string;             // optional human-readable note
  expiresInSeconds?: number;    // for offers: how long until this offer expires
  timestamp: string;
}

export interface NegotiationSession {
  id: string;
  initiatorAgentId: string;
  responderAgentId: string;
  subject: string;              // e.g. "API data access for 30 days", "Treasury yield sweep service"
  status: NegotiationStatus;
  messages: NegotiationMessage[];
  agreedTerms?: NegotiationTerm[];   // set when status = 'accepted'
  escrowId?: string;
  totalRounds: number;
  maxRounds: number;            // default 10; auto-reject if exceeded
  createdAt: string;
  updatedAt: string;
  expiresAt: string;            // 24 hours from creation
  settlementTxId?: string;
}

export interface Escrow {
  id: string;
  sessionId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  amountUsd: number;
  asset: 'USDC' | 'USDT';
  chain: 'base' | 'ethereum' | 'polygon';
  status: EscrowStatus;
  fundedAt?: string;
  releasedAt?: string;
  disputeReason?: string;
  createdAt: string;
}
