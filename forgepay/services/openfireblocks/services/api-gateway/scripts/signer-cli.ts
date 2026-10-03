#!/usr/bin/env -S npx tsx
/**
 * A signer's own tool. It runs on the signer's machine, holds their private key, and never talks to the gateway or the
 * console: you paste in what you were shown, it recomputes what you are approving, shows it to you in plain terms, and
 * only then signs. The signature goes back with the vote (POST .../proposals/:id/votes {"approve":true,"signature":"…"}).
 *
 *   npx tsx scripts/signer-cli.ts keygen  --out ~/.forge/alice.key
 *   npx tsx scripts/signer-cli.ts enroll  --key ~/.forge/alice.key --customer ws-1 --email alice@example.com
 *   npx tsx scripts/signer-cli.ts vote    --key ~/.forge/alice.key --customer ws-1 --proposal proposal.json --approve [--yes]
 *
 * `proposal.json` is the proposal as the gateway returned it. The digest in it is NOT trusted: it is recomputed from
 * the payload, and what the payload says is printed for you to read before you are asked to confirm. Keep the key
 * file offline or on a hardware-protected disk; anyone who holds it can approve as you.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { createInterface } from 'readline/promises';
import { generateSignerKey, signMessage, enrollMessage, voteMessage, payloadDigest } from '../src/common/signer-sig';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (n: string) => process.argv.includes('--' + n);
const need = (n: string) => { const v = arg(n); if (!v) { console.error(`--${n} is required`); process.exit(2); } return v!; };

function readKey(path: string): string {
  const k = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(k)) { console.error('that file does not hold a signer key'); process.exit(2); }
  return k;
}

/** What the payload actually asks for, in words, so the signer approves what they read rather than what they were told. */
export function describeProposal(kind: string, payload: Record<string, any>): string[] {
  const p = payload ?? {};
  switch (kind) {
    case 'approve_transaction': {
      const r = p.request ?? {};
      const lines = [`SEND  value ${r.value ?? '0'} wei  to ${r.to}`, `      on chain ${r.chainId ?? '(network default)'}  nonce ${r.nonce ?? '(assigned at signing)'}`];
      if (r.data && r.data !== '0x') lines.push(`      WITH CALL DATA (${(String(r.data).length - 2) / 2} bytes): ${String(r.data).slice(0, 74)}${String(r.data).length > 74 ? '…' : ''}`);
      if (p.reason) lines.push(`      reason: ${p.reason}`);
      return lines;
    }
    case 'add_signer': return [`ADD SIGNER ${p.email} (${p.name ?? 'no name'}) with public key ${p.publicKey ?? '(none)'}`];
    case 'remove_signer': return [`REMOVE SIGNER ${p.email}`];
    case 'set_signer_key': return [`REPLACE the signing key of ${p.email} with ${p.publicKey}`];
    case 'set_threshold': return [`SET the number of approvals required to ${p.threshold}`];
    case 'rotate_key': return [`ROTATE the signing key's committee to nodes [${(p.nodes ?? []).join(', ')}], ${p.signers_needed} needed to sign`];
    default: return [`${kind}: ${JSON.stringify(p)}`];
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'keygen') {
    const out = need('out');
    if (existsSync(out)) { console.error(`${out} already exists; refusing to overwrite a key`); process.exit(2); }
    const k = generateSignerKey();
    writeFileSync(out, k.privateKeyHex + '\n', { mode: 0o600 });
    chmodSync(out, 0o600);
    console.log(`wrote ${out} (keep it private, offline, and backed up: losing it means a key-replacement proposal needing the other signers)`);
    console.log('public key:', k.publicKeyHex);
    return;
  }
  if (cmd === 'enroll') {
    const priv = readKey(need('key'));
    const customer = need('customer'), email = need('email');
    const { createPrivateKey, createPublicKey } = await import('crypto');
    const pk = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(priv, 'hex')]), format: 'der', type: 'pkcs8' });
    const pub = createPublicKey(pk).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
    console.log(JSON.stringify({ email, publicKey: pub, pop: signMessage(priv, enrollMessage(customer, email, pub)) }, null, 2));
    return;
  }
  if (cmd === 'vote') {
    const priv = readKey(need('key'));
    const customer = need('customer');
    const proposal = JSON.parse(readFileSync(need('proposal'), 'utf8'));
    const approve = flag('approve');
    if (approve === flag('reject')) { console.error('say exactly one of --approve or --reject'); process.exit(2); }
    const digest = payloadDigest(customer, proposal.kind, proposal.request_id ?? null, proposal.payload);
    if (proposal.signing?.digest && proposal.signing.digest !== digest) {
      console.error('WARNING: the digest the gateway reported does not match this payload. Do not sign. The payload may have been altered.');
      process.exit(3);
    }
    console.log(`\nProposal ${proposal.id}  (${proposal.kind})  workspace ${customer}`);
    for (const l of describeProposal(proposal.kind, proposal.payload)) console.log('  ' + l);
    console.log(`  digest ${digest}\n  YOU ARE ABOUT TO ${approve ? 'APPROVE' : 'REJECT'} THIS\n`);
    if (!flag('yes')) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = (await rl.question('Type "sign" to continue: ')).trim();
      rl.close();
      if (a !== 'sign') { console.error('not signed'); process.exit(1); }
    }
    console.log(JSON.stringify({ approve, signature: signMessage(priv, voteMessage(customer, proposal.id, proposal.kind, digest, approve)) }, null, 2));
    return;
  }
  console.error('usage: signer-cli.ts keygen|enroll|vote (see the header of this file)');
  process.exit(2);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
