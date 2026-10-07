/**
 * Key hashing, kept in its own dependency-free module (mirrors the pattern in
 * agent-credit-bureau/src/hash.ts). `auth.ts` needs nothing else from the
 * service, but keeping the crypto isolated here avoids tangling it into any
 * future import graph.
 */
/** sha256 hex digest of an API key. Only digests are ever stored. */
export declare function hashApiKey(raw: string): string;
/** Length-safe, constant-time comparison of two hex digests. */
export declare function safeEqualHex(a: string, b: string): boolean;
//# sourceMappingURL=hash.d.ts.map