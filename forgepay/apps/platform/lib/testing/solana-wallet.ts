/** Test helper: a fresh Solana wallet that can sign messages the way a browser wallet does. Not used by application code. */
import { generateKeyPairSync, sign } from 'node:crypto';

export const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)]! + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}

export function newSolanaWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const address = base58Encode(new Uint8Array(spki.subarray(spki.length - 32)));
  return { address, signMessage: (message: string) => sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64') };
}
