"use strict";
/**
 * Decision Audit Log
 *
 * Append-only ring buffer of recent decisions for observability and replay.
 * Capped at 500 entries; oldest evicted first. Production swaps this for
 * an event stream (Kafka) + cold storage in S3.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDecisionSink = setDecisionSink;
exports.hydrateDecisions = hydrateDecisions;
exports.recordDecision = recordDecision;
exports.getDecisionHistory = getDecisionHistory;
exports.clearDecisionLog = clearDecisionLog;
exports.getLogSize = getLogSize;
const MAX_ENTRIES = 500;
const log = [];
let sink = null;
function setDecisionSink(s) { sink = s; }
/** Load the stored recent decisions, oldest first. */
function hydrateDecisions(decisions) {
    log.length = 0;
    log.push(...decisions.slice(-MAX_ENTRIES));
}
function recordDecision(decision) {
    log.push(decision);
    sink?.record(decision);
    if (log.length > MAX_ENTRIES) {
        log.splice(0, log.length - MAX_ENTRIES);
    }
}
function getDecisionHistory(limit = 50) {
    const safe = Math.min(Math.max(limit, 1), MAX_ENTRIES);
    return log.slice(-safe).reverse();
}
function clearDecisionLog() {
    log.length = 0;
}
function getLogSize() {
    return log.length;
}
//# sourceMappingURL=decision-log.js.map