"use strict";
/**
 * Agent Velocity Tracker
 *
 * Per-agent rolling spend windows used by the risk scorer to detect bursts
 * of activity that exceed daily limits. Held in memory per agent (pruned on write) and written
 * through to Postgres by persistence.ts, so a restart does not reset anyone's window.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVelocitySink = setVelocitySink;
exports.hydrateVelocity = hydrateVelocity;
exports.recordTransaction = recordTransaction;
exports.getVelocity = getVelocity;
exports.clearVelocity = clearVelocity;
const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_1H_MS = 60 * 60 * 1000;
const ledger = new Map();
let sink = null;
function setVelocitySink(s) { sink = s; }
/** Load stored entries (inside the longest window) so a restart does not reset anyone's spend window. */
function hydrateVelocity(entries) {
    ledger.clear();
    for (const e of entries) {
        const list = ledger.get(e.agentId) ?? [];
        list.push({ timestamp: e.timestamp, amountUsd: e.amountUsd });
        ledger.set(e.agentId, list);
    }
}
function recordTransaction(agentId, amountUsd, timestamp) {
    const ts = timestamp ?? Date.now();
    const entries = ledger.get(agentId) ?? [];
    entries.push({ timestamp: ts, amountUsd });
    ledger.set(agentId, entries);
    prune(agentId, ts);
    sink?.record(agentId, ts, amountUsd);
}
function getVelocity(agentId, now) {
    const ref = now ?? Date.now();
    const entries = ledger.get(agentId) ?? [];
    let last1hUsd = 0;
    let last24hUsd = 0;
    let last7dUsd = 0;
    let txCount1h = 0;
    let txCount24h = 0;
    let txCount7d = 0;
    for (const e of entries) {
        const age = ref - e.timestamp;
        if (age <= WINDOW_7D_MS) {
            last7dUsd += e.amountUsd;
            txCount7d += 1;
        }
        if (age <= WINDOW_24H_MS) {
            last24hUsd += e.amountUsd;
            txCount24h += 1;
        }
        if (age <= WINDOW_1H_MS) {
            last1hUsd += e.amountUsd;
            txCount1h += 1;
        }
    }
    return {
        agentId,
        last1hUsd,
        last24hUsd,
        last7dUsd,
        txCount1h,
        txCount24h,
        txCount7d,
        computedAt: new Date(ref).toISOString(),
    };
}
function clearVelocity() {
    ledger.clear();
}
function prune(agentId, now) {
    const entries = ledger.get(agentId);
    if (!entries)
        return;
    const cutoff = now - WINDOW_7D_MS;
    const fresh = entries.filter(e => e.timestamp >= cutoff);
    ledger.set(agentId, fresh);
}
//# sourceMappingURL=velocity.js.map