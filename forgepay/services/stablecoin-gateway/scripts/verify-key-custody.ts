/**
 * Checks that the deposit-key wrapping you have configured really works, against the real
 * key service — not a stand-in. Run it once with production-like credentials before relying on it:
 *
 *   KEY_WRAP_PROVIDER=awskms KEY_WRAP_KMS_KEY_ID=alias/deposit-keys AWS_REGION=eu-west-1 \
 *     npx tsx scripts/verify-key-custody.ts
 *
 *   KEY_WRAP_PROVIDER=vault VAULT_ADDR=https://vault:8200 VAULT_TOKEN=... KEY_WRAP_VAULT_KEY=stablecoin-deposit-keys \
 *     npx tsx scripts/verify-key-custody.ts
 *
 * It creates nothing and stores nothing: it wraps and unwraps throwaway random keys. It shows
 * which identity is calling (so a wrong role is obvious), and checks the properties that matter.
 */
import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import { configuredWrapper, encryptPrivateKey, decryptPrivateKey, setKeyWrapper } from '../src/lib/keystore.js';

let failed = 0;
const step = async (name: string, fn: () => Promise<string | void>) => {
  try { const d = await fn(); console.log(`  ok    ${name}${d ? ` — ${d}` : ''}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name} — ${e instanceof Error ? e.message : e}`); }
};
const mustReject = async (p: Promise<unknown>, why: string) => {
  try { await p; } catch { return; }
  throw new Error(`expected a refusal: ${why}`);
};

(async () => {
  const w = configuredWrapper();
  console.log(`provider: ${w.name}   key: ${w.ref}`);
  if (w.name === 'env') { console.log('KEY_WRAP_PROVIDER is env: nothing external to check. Set awskms or vault.'); process.exit(2); }

  if (w.name === 'awskms') {
    await step('who is calling', async () => {
      const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts').catch(() => ({ STSClient: null, GetCallerIdentityCommand: null } as any));
      if (!STSClient) return 'STS client not installed; skipped';
      const id = await new STSClient({}).send(new GetCallerIdentityCommand({}));
      return id.Arn;
    });
  }

  const pk = ethers.Wallet.createRandom().privateKey;
  const addr = ethers.Wallet.createRandom().address;
  const other = ethers.Wallet.createRandom().address;
  let sealed = '';
  await step('seal a throwaway key (wraps a data key in the key service)', async () => {
    sealed = await encryptPrivateKey(pk, addr);
    const b = JSON.parse(sealed);
    return `wrapped by ${b.wrap.provider}, reference ${b.wrap.ref}`;
  });
  await step('the stored blob does not contain the key', async () => { if (sealed.includes(pk.slice(2))) throw new Error('plaintext found in the blob'); });
  await step('unwrap and open it again', async () => {
    setKeyWrapper(null); // forget the cached data key: this must go back to the key service
    if ((await decryptPrivateKey(sealed, addr)) !== pk) throw new Error('round trip returned a different key');
  });
  await step('the blob will not open for a different deposit address', async () => { await mustReject(decryptPrivateKey(sealed, other), 'wrong address'); });
  await step('an altered blob is refused', async () => {
    const b = JSON.parse(sealed); b.ct = (b.ct[0] === 'a' ? 'b' : 'a') + b.ct.slice(1);
    await mustReject(decryptPrivateKey(JSON.stringify(b), addr), 'tampered ciphertext');
  });
  await step('the key service itself refuses a wrapped key presented with the wrong context', async () => {
    const real = configuredWrapper();
    const dek = randomBytes(32);
    const res = await real.wrap(dek, 'deposit-keys');
    const wrapped = typeof res === 'string' ? res : res.wrapped;
    const ref = typeof res === 'string' ? real.ref : res.ref;
    if (real.name === 'awskms') await mustReject(real.unwrap(wrapped, ref, 'some-other-purpose'), 'encryption context mismatch');
    const back = await real.unwrap(wrapped, ref, 'deposit-keys');
    if (!back.equals(dek)) throw new Error('unwrapped a different data key');
    return real.name === 'awskms' ? 'encryption context enforced by KMS' : 'round trip ok (Vault transit has no per-call context; the address binding above is what protects each blob)';
  });

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
