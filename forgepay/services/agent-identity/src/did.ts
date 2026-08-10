/**
 * FORGE DID — canonical parser, minter and compatibility shim.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * Three incompatible DID methods grew up in the monorepo with no bridge:
 *
 *   agent-credit-bureau   parsed only  did:fp:0x<40hex>     — nothing ever minted it
 *   forge-wallet          mints        did:forge:user_<uuid> / did:forge:agent_<uuid>
 *   agent-identity        mints        did:forgepay:<uuid>
 *
 * Every `did:fp:` string in the repository is fixture data, so the bureau was
 * parsing a format no production code produces. Any agent registered through
 * agent-identity or forge-wallet was skipped at settlement on every run,
 * forever, with the failure visible only in a run-log array.
 *
 * The deeper bug was that `didToAddress()` string-sliced an EVM address out of
 * an identifier — conflating *identity* (who this is) with *capability* (which
 * on-chain account they control). An address is now an explicit field on the
 * profile; this module only reports an address when the DID is genuinely
 * self-certifying.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The canonical method: `did:forge:`
 *
 *   Address form   did:forge:0x<40hex>              self-certifying
 *   Registry form  did:forge:agent_<id>             opaque; address held separately
 *                  did:forge:user_<id>
 *
 * Accepted as legacy aliases, normalised on read, never minted again:
 *
 *   did:fp:0x<40hex>      → address form
 *   did:forgepay:<id>     → registry form
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Deployment note
 *
 * This file is deliberately duplicated into each service rather than extracted
 * into a package. There is no workspace linkage in this repo — the root
 * package.json is Hyperswitch's, every service carries its own lockfile, and
 * each Dockerfile's build context is the service directory alone
 * (`COPY package*.json ./` then `COPY src/`). A shared package would break
 * every Dockerfile and CI job. Keep the copies byte-identical.
 */

import { randomUUID } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DidMethod = 'forge' | 'fp' | 'forgepay';
export type DidForm = 'address' | 'registry';

export interface ParsedDid {
  /** The method actually present in the input. */
  method: DidMethod;
  /** Whether the identifier carries its own address or needs a lookup. */
  form: DidForm;
  /** Method-specific id, verbatim (checksummed when it is an address). */
  id: string;
  /** Present only for the address form. EIP-55 checksummed. */
  address?: string;
  /** The equivalent `did:forge:` string. Already canonical inputs return themselves. */
  canonical: string;
  /** True when the input was already in canonical form. */
  wasCanonical: boolean;
}

// ── Address handling ──────────────────────────────────────────────────────────

/**
 * Anchored on purpose. The previous implementation used an unanchored
 * `did.match(/did:fp:(0x[0-9a-fA-F]{40})/)`, so `"garbage did:fp:0xAA…AA junk"`
 * parsed successfully, and a 42-hex-character tail silently matched its first
 * 40 characters.
 */
const ADDRESS_BODY = /^0x[0-9a-fA-F]{40}$/;

/** Conservative id charset for the registry form: uuid, slug or prefixed uuid. */
const REGISTRY_BODY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * EIP-55 checksum an address.
 *
 * Implemented locally rather than via viem's `getAddress` so this module stays
 * dependency-free and byte-identical across services that do not all carry
 * viem. Throws for malformed input; callers should pre-check with
 * `isAddressBody`.
 */
export function toChecksumAddress(address: string): string {
  if (!ADDRESS_BODY.test(address)) {
    throw new Error(`Not a 20-byte hex address: ${address}`);
  }
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256Hex(lower);

  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out;
}

export function isAddressBody(value: string): boolean {
  return ADDRESS_BODY.test(value);
}

/**
 * Compare two addresses for account equality, ignoring case.
 *
 * The bureau previously returned the address exactly as written in the DID, so
 * the same account expressed in two cases produced two different `Address`
 * strings and compared unequal.
 */
export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

// ── Parsing ───────────────────────────────────────────────────────────────────

const METHODS: Record<string, DidMethod> = {
  forge: 'forge',
  fp: 'fp',
  forgepay: 'forgepay',
};

/**
 * Parse any accepted DID form.
 *
 * @returns null for anything unrecognised — including empty strings, unknown
 *          methods, and bodies that fail their form's shape check. Never throws.
 */
export function parseDid(input: unknown): ParsedDid | null {
  if (typeof input !== 'string') return null;

  const did = input.trim();
  // Anchored: exactly `did:<method>:<body>`. The body may itself contain
  // colons (e.g. did:forge:entity:EIN-…), so split only on the first two.
  const first = did.indexOf(':');
  if (first === -1) return null;
  const second = did.indexOf(':', first + 1);
  if (second === -1) return null;

  if (did.slice(0, first) !== 'did') return null;

  const methodRaw = did.slice(first + 1, second);
  const body = did.slice(second + 1);

  const method = METHODS[methodRaw];
  if (!method || !body) return null;

  // ── Address form ────────────────────────────────────────────────────────
  if (isAddressBody(body)) {
    // `did:forgepay:0x…` is not a shape anything mints; treat an address body
    // under any accepted method as the address form rather than rejecting it.
    const address = toChecksumAddress(body);
    const canonical = `did:forge:${address}`;
    return {
      method,
      form: 'address',
      id: address,
      address,
      canonical,
      wasCanonical: method === 'forge' && body === address,
    };
  }

  // ── Registry form ───────────────────────────────────────────────────────
  // `did:fp:` only ever denoted an address. A non-address body under it is
  // malformed rather than a registry identifier.
  if (method === 'fp') return null;

  if (!REGISTRY_BODY.test(body)) return null;

  return {
    method,
    form: 'registry',
    id: body,
    canonical: `did:forge:${body}`,
    wasCanonical: method === 'forge',
  };
}

/** True when `did` parses and is already `did:forge:` in normalised form. */
export function isCanonical(did: unknown): boolean {
  return parseDid(did)?.wasCanonical ?? false;
}

/** True when `did` parses at all, under any accepted method. */
export function isValidDid(did: unknown): boolean {
  return parseDid(did) !== null;
}

/**
 * The EVM address a DID self-certifies, or null when it does not carry one.
 *
 * A registry-form DID returning null is the correct answer, not a failure — its
 * address lives on the profile, not in the identifier.
 */
export function addressFromDid(did: unknown): string | null {
  return parseDid(did)?.address ?? null;
}

/** Rewrite any accepted DID into canonical form. Returns null if unparseable. */
export function toCanonicalDid(did: unknown): string | null {
  return parseDid(did)?.canonical ?? null;
}

// ── Minting ───────────────────────────────────────────────────────────────────

export function mintAgentDid(id: string = randomUUID()): string {
  return `did:forge:agent_${id}`;
}

export function mintUserDid(id: string = randomUUID()): string {
  return `did:forge:user_${id}`;
}

/** Build the self-certifying form for an EVM account. */
export function didFromAddress(address: string): string {
  return `did:forge:${toChecksumAddress(address)}`;
}

// ── keccak256 ─────────────────────────────────────────────────────────────────
//
// EIP-55 needs keccak256, which Node's crypto does not provide (its `sha3-256`
// is the NIST variant with different padding and produces a different digest).
// A compact implementation keeps this module dependency-free so it can be
// copied verbatim into services that do not carry viem or js-sha3.
//
// Verified against the four published EIP-55 vectors and against viem's
// `getAddress` across 500 random addresses — see did.test.ts.

const KECCAK_ROUNDS = 24;

const RC = [
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000,
  0x80008000, 0x80000000, 0x0000808b, 0x00000000, 0x80000001, 0x00000000,
  0x80008081, 0x80000000, 0x00008009, 0x80000000, 0x0000008a, 0x00000000,
  0x00000088, 0x00000000, 0x80008009, 0x00000000, 0x8000000a, 0x00000000,
  0x8000808b, 0x00000000, 0x0000008b, 0x80000000, 0x00008089, 0x80000000,
  0x00008003, 0x80000000, 0x00008002, 0x80000000, 0x00000080, 0x80000000,
  0x0000800a, 0x00000000, 0x8000000a, 0x80000000, 0x80008081, 0x80000000,
  0x00008080, 0x80000000, 0x80000001, 0x00000000, 0x80008008, 0x80000000,
];

const ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
  27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

function keccakF(s: BigUint64Array): void {
  const bc = new BigUint64Array(5);
  const MASK = (1n << 64n) - 1n;
  const rotl = (x: bigint, n: bigint) => ((x << n) | (x >> (64n - n))) & MASK;

  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    for (let i = 0; i < 5; i++) {
      bc[i] = s[i]! ^ s[i + 5]! ^ s[i + 10]! ^ s[i + 15]! ^ s[i + 20]!;
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5]! ^ rotl(bc[(i + 1) % 5]!, 1n);
      for (let j = 0; j < 25; j += 5) s[j + i] = s[j + i]! ^ t;
    }

    let t = s[1]!;
    for (let i = 0; i < 24; i++) {
      const j = PILN[i]!;
      const tmp = s[j]!;
      s[j] = rotl(t, BigInt(ROTC[i]!));
      t = tmp;
    }

    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = s[j + i]!;
      for (let i = 0; i < 5; i++) {
        s[j + i] = bc[i]! ^ (~bc[(i + 1) % 5]! & bc[(i + 2) % 5]!) & MASK;
      }
    }

    const lo = BigInt(RC[round * 2]! >>> 0);
    const hi = BigInt(RC[round * 2 + 1]! >>> 0);
    s[0] = s[0]! ^ ((hi << 32n) | lo);
  }
}

/** keccak256 of an ASCII string, returned as lowercase hex. */
function keccak256Hex(message: string): string {
  const rate = 136; // 1088 bits, keccak256
  const input = Buffer.from(message, 'utf8');

  const padded = Buffer.alloc(Math.ceil((input.length + 1) / rate) * rate);
  input.copy(padded);
  padded[input.length] = 0x01;          // Keccak padding, not SHA-3's 0x06
  padded[padded.length - 1]! |= 0x80;

  const state = new BigUint64Array(25);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      state[i] = state[i]! ^ padded.readBigUInt64LE(offset + i * 8);
    }
    keccakF(state);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(state[i]!, i * 8);
  return out.toString('hex');
}
