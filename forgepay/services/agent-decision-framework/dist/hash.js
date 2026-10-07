"use strict";
/**
 * Key hashing, kept in its own dependency-free module (mirrors the pattern in
 * agent-credit-bureau/src/hash.ts). `auth.ts` needs nothing else from the
 * service, but keeping the crypto isolated here avoids tangling it into any
 * future import graph.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashApiKey = hashApiKey;
exports.safeEqualHex = safeEqualHex;
const node_crypto_1 = require("node:crypto");
/** sha256 hex digest of an API key. Only digests are ever stored. */
function hashApiKey(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw, 'utf8').digest('hex');
}
/** Length-safe, constant-time comparison of two hex digests. */
function safeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(bufA, bufB);
}
//# sourceMappingURL=hash.js.map