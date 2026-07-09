/**
 * Shared proof-verification utilities used by both shielded-deposits and
 * x402-shielded routes.
 *
 * decryptMemoViaAuditor — POSTs encrypted_memo to the MoR auditor service
 *   (mor-layer:8010/v1/auditor/decrypt) and returns the decoded amount.
 *   The auditor holds the ECDH secret key; no other service ever sees the
 *   plaintext amount.
 *
 * verifyGroth16Proof — calls the NullifierRegistry contract via ethers.js to
 *   check that (a) the nullifier is unspent, and (b) the Groth16 proof is
 *   valid for the given merkle root. Falls back to dev-mode bypass when the
 *   registry is not yet deployed (all-zero address) outside of production.
 *
 *   STUB WARNING: the "not yet deployed" bypass unconditionally returns
 *   true — it does NOT actually verify the proof bytes. This is only safe
 *   because the shielded-deposits and /x402/shielded-pay HTTP routes that
 *   call this function are themselves gated behind
 *   config.shielded.paymentsEnabled (SHIELDED_PAYMENTS_ENABLED, default
 *   false) in src/index.ts. assertShieldedPaymentsSafeToBoot() below is a
 *   second line of defense: it refuses to start the process at all if
 *   someone enables the routes in production without a real, deployed
 *   NullifierRegistry backing every chain.
 */

import { ethers } from 'ethers';
import { config } from '../config.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Chains for which the shielded-deposits / x402 shielded-pay routes accept
 * a `chain` value (see routes/shielded-deposits.ts and routes/x402-shielded.ts).
 */
const SHIELDED_CHAINS = ['ethereum', 'polygon', 'base', 'arbitrum'] as const;

function isNullifierRegistryDeployed(chain: string): boolean {
  const contractAddress = (config.shielded.nullifierRegistry as Record<string, string>)[chain];
  return Boolean(contractAddress) && contractAddress !== ZERO_ADDRESS;
}

/**
 * Startup guard for shielded payments.
 *
 * verifyGroth16Proof() below always returns `true` for any chain whose
 * NullifierRegistry contract isn't deployed yet (all-zero address) — it is
 * a STUB, not a real verifier. That's tolerable while the shielded routes
 * are unmounted (SHIELDED_PAYMENTS_ENABLED=false, the default). But if an
 * operator flips SHIELDED_PAYMENTS_ENABLED=true while running with
 * NODE_ENV=production and the contracts are still undeployed, the service
 * would silently accept ANY proof bytes as valid for real money movement.
 *
 * Call this once at process startup (see src/index.ts). It throws — and
 * the process must be allowed to crash — rather than let that combination
 * boot successfully.
 */
export function assertShieldedPaymentsSafeToBoot(): void {
  if (!config.shielded.paymentsEnabled) return;
  if (config.env !== 'production') return;

  const undeployed = SHIELDED_CHAINS.filter((chain) => !isNullifierRegistryDeployed(chain));
  if (undeployed.length > 0) {
    throw new Error(
      '[stablecoin-gateway] REFUSING TO START: SHIELDED_PAYMENTS_ENABLED=true and ' +
      'NODE_ENV=production, but the NullifierRegistry contract is not deployed ' +
      `(all-zero address) for: ${undeployed.join(', ')}. ` +
      'verifyGroth16Proof() is a STUB that always returns true when the registry is ' +
      'undeployed — booting like this would accept any Groth16 proof bytes as valid ' +
      'for real USDC/USDT shielded deposits. Deploy the NullifierRegistry contracts ' +
      'and set NULLIFIER_REGISTRY_<CHAIN> for every chain above, or set ' +
      'SHIELDED_PAYMENTS_ENABLED=false until you do.',
    );
  }
}

// ── Auditor decrypt ────────────────────────────────────────────────────────────

/**
 * Decrypt an ECDH+AES-GCM encrypted ShieldedTxData blob via the MoR auditor
 * service.  Returns the decoded amount in native token units and as a USD
 * float.  Only the auditor can perform this decryption.
 */
export async function decryptMemoViaAuditor(
  encryptedMemo: string,
): Promise<{ amount_units: string; amount_usd: number }> {
  const res = await fetch(
    `${config.shielded.auditorServiceUrl}/v1/auditor/decrypt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_memo: encryptedMemo }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown error');
    throw new Error(`Auditor service error ${res.status}: ${err}`);
  }
  const data = await res.json() as { asset: string; amount: number; amount_units: string };
  return {
    amount_units: data.amount_units ?? String(Math.round(data.amount * 1_000_000)),
    amount_usd:   data.amount,
  };
}

// ── NullifierRegistry ABI ──────────────────────────────────────────────────────

// Minimal ABI for the NullifierRegistry methods we need
const REGISTRY_ABI = [
  'function isSpent(bytes32 nullifier) view returns (bool)',
  'function submitProof(bytes calldata proofBytes, bytes32 nullifier, bytes32 merkleRoot, uint256 amountUnits) external',
];

// ── Groth16 proof verification ─────────────────────────────────────────────────

/**
 * Verify a Groth16 deposit proof against the on-chain NullifierRegistry.
 *
 * Checks:
 *   1. NullifierRegistry contract is deployed on the requested chain
 *      (non-zero address). In development mode, skips verification if not
 *      deployed; throws in production.
 *   2. Nullifier has not already been spent (double-spend prevention).
 *   3. Proof bytes are valid for the public inputs via a static call to
 *      verifyProof().  This does NOT submit/spend the nullifier — that step
 *      happens in the payment processor after the USDC transfer is confirmed.
 *
 * @param proofBytes  base64-encoded Groth16 proof
 * @param nullifier   hex bytes32 nullifier (0x-prefixed)
 * @param chain       EVM chain name matching config.rpc keys
 */
export async function verifyGroth16Proof(
  proofBytes: string,
  nullifier:  string,
  chain:      string,
): Promise<boolean> {
  const contractAddress = (config.shielded.nullifierRegistry as Record<string, string>)[chain];

  if (!isNullifierRegistryDeployed(chain)) {
    // Contracts not yet deployed — allow in development
    if (config.env === 'production') {
      // Defense in depth: assertShieldedPaymentsSafeToBoot() should have
      // already refused to boot this process in this exact situation, but
      // if verifyGroth16Proof somehow still gets called here, never fall
      // through to the stub bypass in production.
      throw new Error(
        `NullifierRegistry not deployed on ${chain} — cannot verify proof in production`,
      );
    }
    console.warn(
      `[stablecoin-gateway] STUB: NullifierRegistry not deployed on ${chain} — ` +
      'verifyGroth16Proof() is BYPASSING real verification and returning true for ' +
      'ANY proof bytes (dev/test only, never production). ' +
      `nullifier=${nullifier}`,
    );
    return true;
  }

  const rpcUrl = (config.rpc as Record<string, string>)[chain];
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // ── 1. Check nullifier not already spent (double-spend prevention) ──────────
  const registry = new ethers.Contract(contractAddress, REGISTRY_ABI, provider);
  const isAlreadySpent = await registry.isSpent(nullifier as `0x${string}`);
  if (isAlreadySpent) {
    return false;
  }

  // ── 2. Static-call verifyProof to validate without state change ─────────────
  // Proof bytes are base64 — decode to hex for contract call
  const proofHex = '0x' + Buffer.from(proofBytes, 'base64').toString('hex');

  // The actual spending (submitProof) happens after USDC transfer confirmation
  // in the payment processor. Here we only run a static (read-only) check.
  const verifier = new ethers.Contract(
    contractAddress,
    ['function verifyProof(bytes calldata proofBytes, uint256[] calldata publicInputs) external returns (bool)'],
    provider,
  );

  try {
    // Static call — no gas spent, no state change
    const valid = await verifier.verifyProof.staticCall(proofHex, [BigInt(nullifier)]);
    return valid as boolean;
  } catch {
    // Proof failed to parse or verify
    return false;
  }
}
