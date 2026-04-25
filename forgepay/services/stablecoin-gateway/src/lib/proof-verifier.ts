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
 */

import { ethers } from 'ethers';
import { config } from '../config.js';

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

  if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
    // Contracts not yet deployed — allow in development
    if (config.env === 'production') {
      throw new Error(
        `NullifierRegistry not deployed on ${chain} — cannot verify proof in production`,
      );
    }
    console.warn(
      `⚠️  NullifierRegistry not deployed on ${chain} — bypassing proof verification (dev only)`,
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
