/**
 * Decision Audit Log
 *
 * Append-only ring buffer of recent decisions for observability and replay.
 * Capped at 500 entries; oldest evicted first. Production swaps this for
 * an event stream (Kafka) + cold storage in S3.
 */
import { Decision } from './types';
/** Where decisions are made durable. Set by persistence.ts when a database is configured. */
export interface DecisionSink {
    record(d: Decision): void;
}
export declare function setDecisionSink(s: DecisionSink | null): void;
/** Load the stored recent decisions, oldest first. */
export declare function hydrateDecisions(decisions: Decision[]): void;
export declare function recordDecision(decision: Decision): void;
export declare function getDecisionHistory(limit?: number): Decision[];
export declare function clearDecisionLog(): void;
export declare function getLogSize(): number;
//# sourceMappingURL=decision-log.d.ts.map