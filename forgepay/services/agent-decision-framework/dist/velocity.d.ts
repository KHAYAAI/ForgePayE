/**
 * Agent Velocity Tracker
 *
 * Per-agent rolling spend windows used by the risk scorer to detect bursts
 * of activity that exceed daily limits. Held in memory per agent (pruned on write) and written
 * through to Postgres by persistence.ts, so a restart does not reset anyone's window.
 */
import { VelocityWindow } from './types';
/** Where entries are made durable. Set by persistence.ts when a database is configured. */
export interface VelocitySink {
    record(agentId: string, timestamp: number, amountUsd: number): void;
}
export declare function setVelocitySink(s: VelocitySink | null): void;
/** Load stored entries (inside the longest window) so a restart does not reset anyone's spend window. */
export declare function hydrateVelocity(entries: Array<{
    agentId: string;
    timestamp: number;
    amountUsd: number;
}>): void;
export declare function recordTransaction(agentId: string, amountUsd: number, timestamp?: number): void;
export declare function getVelocity(agentId: string, now?: number): VelocityWindow;
export declare function clearVelocity(): void;
//# sourceMappingURL=velocity.d.ts.map