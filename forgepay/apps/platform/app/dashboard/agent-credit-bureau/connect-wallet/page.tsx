'use client';

import { useState } from 'react';
import { PageHeader, Panel, Mono } from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau: Connect your own wallet.
   The non-custodial way to register an agent. You keep the key in your own
   wallet and sign a message that names the address and the agent. FORGE checks
   the signature and registers the agent under that wallet's identity. FORGE
   never sees a key, and signing moves no funds.
   ──────────────────────────────────────────────────────────────── */

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const provider = (): Eip1193 | null =>
  typeof window === 'undefined' ? null : ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null);

// Solana wallets (Phantom and compatible) expose connect() and signMessage(bytes). The message is signed as raw bytes; no transaction is built.
type SolanaWallet = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (m: Uint8Array, display?: 'utf8') => Promise<{ signature: Uint8Array }>;
};
const solanaProvider = (): SolanaWallet | null =>
  typeof window === 'undefined' ? null : ((window as unknown as { solana?: SolanaWallet }).solana ?? null);

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

const toHex = (s: string) => '0x' + Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('');

export default function ConnectWallet() {
  const [chain, setChain] = useState<'evm' | 'solana'>('evm');
  const [address, setAddress] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [entityType, setEntityType] = useState('llc');
  const [entityId, setEntityId] = useState('');
  const [legalName, setLegalName] = useState('');
  const [country, setCountry] = useState('ZA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ agentId: string; did: string } | null>(null);

  const connect = async () => {
    setError(null);
    if (chain === 'solana') {
      const sol = solanaProvider();
      if (!sol) { setError('No Solana wallet found in this browser. Install one (for example Phantom), or open this page in your wallet\'s browser.'); return; }
      try {
        const { publicKey } = await sol.connect();
        setAddress(publicKey.toString());
      } catch {
        setError('The wallet did not share an account. Nothing was changed.');
      }
      return;
    }
    const eth = provider();
    if (!eth) { setError('No wallet found in this browser. Install a wallet extension, or open this page in your wallet\'s browser.'); return; }
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      setAddress(accounts[0] ?? null);
    } catch {
      setError('The wallet did not share an account. Nothing was changed.');
    }
  };

  const signAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const eth = provider();
    const sol = solanaProvider();
    if (!address || (chain === 'evm' ? !eth : !sol)) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const start = await fetch('/api/forge/wallet-bind/challenge', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, agentId: agentId.trim() }),
      });
      const challenge = await start.json().catch(() => null);
      if (!start.ok) { setError(challenge?.message ?? 'Could not start. Try again.'); return; }

      let signature: string;
      try {
        signature = chain === 'solana'
          ? toBase64((await sol!.signMessage(new TextEncoder().encode(challenge.data.message), 'utf8')).signature)
          : ((await eth!.request({ method: 'personal_sign', params: [toHex(challenge.data.message), address] })) as string);
      } catch {
        setError('You declined to sign. Nothing was changed.');
        return;
      }

      const res = await fetch('/api/forge/wallet-bind/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nonce: challenge.data.nonce, signature, operatorEntityId: entityId.trim(), operatorEntityType: entityType,
          operatorLegalName: legalName.trim() || undefined, operatorCountry: country.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.message ?? 'Could not register that agent.'); return; }
      setDone({ agentId: body.data.agentId, did: body.data.did });
    } catch {
      setError('Could not reach the console. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Connect wallet"
        title={<>Register an agent with <em>your own wallet</em></>}
        lede="You keep the key. Sign one message to prove you control the wallet, and the agent is registered under that wallet's identity. FORGE never sees a key, and signing moves no funds."
      />

      <Panel title="1. Connect" label="your wallet">
        <label style={{ display: 'block', marginBottom: 12 }}>Wallet type
          <select value={chain} onChange={(e) => { setChain(e.target.value as 'evm' | 'solana'); setAddress(null); setError(null); }}>
            <option value="evm">Ethereum, Base or other EVM wallet</option>
            <option value="solana">Solana wallet</option>
          </select>
        </label>
        {address
          ? <p>Connected: <Mono>{address}</Mono></p>
          : <button className="btn-primary" onClick={connect}>Connect wallet</button>}
      </Panel>

      <Panel title="2. Describe the agent and sign" label="POST /api/forge/wallet-bind/*">
        <form onSubmit={signAndRegister} style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
          <label>Agent id
            <input required value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="a name you will recognise" />
          </label>
          <label>Operator type
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="llc">Company (LLC / Pty Ltd)</option>
              <option value="corp">Corporation</option>
              <option value="dao">DAO</option>
              <option value="individual">Individual</option>
            </select>
          </label>
          <label>Operator id (your own reference)
            <input required value={entityId} onChange={(e) => setEntityId(e.target.value)} />
          </label>
          <label>Operator legal name
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </label>
          <label>Country of registration
            <input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} />
          </label>
          <button className="btn-primary" type="submit" disabled={busy || !address}>{busy ? 'Waiting for your wallet…' : 'Sign and register'}</button>
        </form>
        {error && <p role="alert" style={{ marginTop: 12 }}>{error}</p>}
        {done && (
          <p style={{ marginTop: 12 }}>
            Registered <Mono>{done.agentId}</Mono> as <Mono>{done.did}</Mono>. It starts at 300 and builds its record as repayments are reported.
          </p>
        )}
      </Panel>
    </>
  );
}
