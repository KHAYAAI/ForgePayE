const CODE_SNIPPET = `import { ForgePay } from '@forgepay/sdk';

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

export default function DeveloperPreview() {
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
              {/* Title bar */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-white/[0.02]">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
                <span className="ml-3 text-xs text-gray-500 font-mono">payments.ts</span>
              </div>

              {/* Code */}
              <pre className="p-5 overflow-x-auto text-[12px] leading-relaxed font-mono">
                <code className="text-gray-300 whitespace-pre">
                  {CODE_SNIPPET
                    .split('\n')
                    .map((line, i) => {
                      // Very lightweight syntax highlights via spans
                      const highlighted = line
                        .replace(/\/\/ .*$/g, (m) => `<span class="text-gray-500">${m}</span>`)
                        .replace(/(import|const|await|new|process\.env\.\w+)/g, (m) => `<span class="text-purple-400">${m}</span>`)
                        .replace(/('[^']*')/g, (m) => `<span class="text-green-400">${m}</span>`)
                        .replace(/\b(\d[\d_]*)\b/g, (m) => `<span class="text-orange-300">${m}</span>`);
                      return (
                        <span key={i} dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} />
                      );
                    })}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
