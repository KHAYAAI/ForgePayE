export type AgentFramework = 'elizaos' | 'swarms' | 'autogen' | 'langchain' | 'crewai' | 'forgepay' | 'custom';
export type TrustLevel = 'unverified' | 'verified' | 'trusted' | 'premium';

export interface AgentIdentity {
  id: string;                    // UUID
  did: string;                   // did:forgepay:{id}
  name: string;
  framework: AgentFramework;
  ownerMerchantId: string;       // ForgePay merchant who registered this agent
  publicKey?: string;            // Ed25519 public key for message signing (hex)
  webhookUrl?: string;           // Where to receive negotiation requests
  capabilities: string[];        // e.g. ['payment', 'negotiation', 'data_analysis']
  trustLevel: TrustLevel;
  reputationScore: number;       // 0-1000, starts at 500
  totalTransactions: number;
  totalVolumeUsd: number;
  successRate: number;           // 0-1
  averageResponseTimeMs: number;
  tags: string[];                // e.g. ['treasury', 'marketplace', 'data_broker']
  createdAt: string;
  lastActiveAt: string;
  status: 'active' | 'suspended' | 'deregistered';
  // KYAPay external identity link (nullable — only set for imported agents)
  kyapaySub?: string;            // JWT sub claim from external KYAPay issuer
  kyapayIss?: string;            // JWT iss claim (e.g. "https://skyfire.xyz")
}

export interface ReputationEvent {
  id: string;
  agentId: string;
  eventType: 'transaction_success' | 'transaction_failure' | 'dispute_raised' | 'dispute_resolved' | 'late_payment' | 'fraud_detected' | 'vouched_by_trusted';
  scoreDelta: number;            // positive or negative
  description: string;
  relatedAgentId?: string;       // counterparty agent
  transactionId?: string;
  createdAt: string;
}

export interface Attestation {
  id: string;
  subjectAgentId: string;        // the agent being attested
  issuerAgentId?: string;        // the agent attesting (null = ForgePay system)
  issuerMerchantId: string;
  claim: string;                 // e.g. "verified_treasury_operator" | "compliant_marketplace_buyer"
  data: Record<string, unknown>; // supporting evidence
  expiresAt?: string;
  createdAt: string;
}

export interface AgentDiscovery {
  agentId: string;
  did: string;
  name: string;
  framework: AgentFramework;
  capabilities: string[];
  trustLevel: TrustLevel;
  reputationScore: number;
  successRate: number;
  tags: string[];
  webhookUrl?: string;
}
