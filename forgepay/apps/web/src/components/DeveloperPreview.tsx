'use client';

import { useState } from 'react';
import { Copy, CheckCheck } from 'lucide-react';

// ─── Code snippets ────────────────────────────────────────────────────────────

const SNIPPET_SDK = `import { ForgePay } from '@forgepay/sdk';

const fp = new ForgePay({ apiKey: process.env.FORGEPAY_API_KEY });

// ✦ Accept a card payment
const payment = await fp.payments.create({
  amount: 4900,          // $49.00 in cents
  currency: 'USD',
  customerId: 'cus_abc',
  idempotencyKey: 'order_001',
});

// ✦ Accept USDC on Base (L2, near-zero gas)
const stablecoin = await fp.stablecoins.create({
  amount: '49.00',
  currency: 'USDC',
  chain: 'base',
  customerId: 'cus_abc',
});

// ✦ Create an AI usage-based subscription
const sub = await fp.subscriptions.create({
  customerId: 'cus_abc',
  planId: 'plan_ai_tokens',
  metadata: { model: 'gpt-4o', tokens_per_unit: 1000 },
});

// ✦ Report token usage for billing
await fp.usage.report({
  subscriptionId: sub.id,
  units: 150_000,    // 150k tokens consumed
  timestamp: new Date(),
});`;

const SNIPPET_SHIELDED = `// Shielded payment — client never sends plaintext amount
const seed = await fp.proofs.deriveSeed(email, password);
await fp.proofs.initProofGenerator(seed);

const { proof, commitment } = await fp.proofs.generateDepositProof({
  asset: 0,      // USDC
  amountUsd: 49.00,
});

const session = await fp.checkout.createShielded({
  merchant_id: 'merch_123',
  encrypted_memo: encryptedMemo,
  audit_proof: proof,
  success_url: 'https://yourapp.com/success',
});`;

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'SDK' | 'Shielded';

const TABS: { key: TabKey; label: string; filename: string; snippet: string }[] = [
  { key: 'SDK',      label: 'SDK',      filename: 'payments.ts',          snippet: SNIPPET_SDK },
  { key: 'Shielded', label: 'Shielded', filename: 'shielded-payment.ts',  snippet: SNIPPET_SHIELDED },
];

// ─── Syntax highlight helper ──────────────────────────────────────────────────

function highlight(line: string): string {
  return line
    .replace(/\/\/ .*$/g,                  (m) => `<span class="text-gray-500">${m}</span>`)
    .replace(/(import|const|await|new|process\.env\.\w+)/g, (m) => `<span class="text-purple-400">${m}</span>`)
    .replace(/('[^']*')/g,                 (m) => `<span class="text-green-400">${m}</span>`)
    .replace(/\b(\d[\d_.]*)\b/g,           (m) => `<span class="text-orange-300">${m}</span>`);
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable in some contexts — silently ignore
    }
  };

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy code"
      className="flex items-center gap-1.5 text-white/30 hover:text-white/60 text-xs font-medium transition-colors duration-150 px-2 py-1 rounded-md hover:bg-white/5"
    >
      {copied ? (
        <>
          <CheckCheck size={13} className="text-cyan-400" />
          <span className="text-cyan-400">Copied</span>
        </>
      ) : (
        <>
          <Copy size={13} />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DeveloperPreview() {
  const [activeTab, setActiveTab] = useState<TabKey>('SDK');

  const current = TABS.find((t) => t.key === activeTab)!;

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left — copy */}
          <div>
            <div className="inline-block bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-1 text-xs font-semibold text-cyan-400 uppercase tracking-wide mb-4">
              Developer-first
            </div>
            <h2 className="text-4xl sm:text-5xl font-black mb-6 tracking-tight">
              One SDK.{' '}
              <span className="text-cyan-500">Everything works.</span>
            </h2>
            <p className="text-gray-400 text-base leading-relaxed mb-6">
              Cards, stablecoins, crypto, subscriptions, and usage-based billing — all through a
              single idiomatic SDK. Full TypeScript types. No context-switching between 5
              different providers.
            </p>
            <ul className="space-y-3 text-sm text-gray-300">
              {[
                'Full TypeScript types from OpenAPI 3.1 spec',
                'Automatic retries + exponential backoff',
                'Idempotency keys on every mutation',
                'WebSocket stream for real-time payment events',
                'Python and Rust SDKs available',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Right — code block */}
          <div className="relative">
            {/* Glow effect behind code block */}
            <div className="absolute -inset-4 bg-cyan-500/5 rounded-3xl blur-xl" />
            <div className="relative bg-navy-900/80 border border-white/10 rounded-2xl overflow-hidden">
              {/* Title bar with tab switcher */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-white/[0.02]">
                {/* Traffic lights */}
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />

                {/* Tabs */}
                <div className="flex gap-1 ml-3">
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`px-3 py-0.5 rounded-md text-xs font-mono transition-all duration-150 ${
                        activeTab === tab.key
                          ? 'bg-white/10 text-white'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {tab.label}
                      {tab.key === 'Shielded' && (
                        <span className="ml-1.5 text-[9px] font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-1.5 py-px uppercase tracking-wide align-middle">
                          ZK
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* filename + copy button */}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-gray-600 font-mono hidden sm:inline">
                    {current.filename}
                  </span>
                  <CopyButton code={current.snippet} />
                </div>
              </div>

              {/* Code */}
              <pre className="p-5 overflow-x-auto text-[12px] leading-relaxed font-mono">
                <code className="text-gray-300 whitespace-pre">
                  {current.snippet
                    .split('\n')
                    .map((line, i) => (
                      <span key={i} dangerouslySetInnerHTML={{ __html: highlight(line) + '\n' }} />
                    ))}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
