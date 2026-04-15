const STEPS = [
  {
    number: '01',
    title: 'Sign up and get your API key',
    description:
      'Create your ForgePay account in 60 seconds. Get a test API key instantly — no sales calls, no manual approval.',
  },
  {
    number: '02',
    title: 'Install the SDK',
    description:
      'npm install @forgepay/sdk or pip install forgepay. Full TypeScript types included. OpenAPI spec available.',
    code: 'npm install @forgepay/sdk',
  },
  {
    number: '03',
    title: 'Create your first payment',
    description:
      'One API call handles cards, stablecoins, and crypto. ForgePay routes to the best processor automatically.',
  },
  {
    number: '04',
    title: 'Go live — we handle the rest',
    description:
      'Tax compliance, billing, webhooks, reconciliation, and retries are all managed by ForgePay. You ship, we handle the plumbing.',
  },
];

export default function HowItWorks() {
  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-white/[0.02] border-y border-white/5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-block bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-1 text-xs font-semibold text-cyan-400 uppercase tracking-wide mb-4">
            Simple integration
          </div>
          <h2 className="text-4xl sm:text-5xl font-black mb-4 tracking-tight">
            Live in{' '}
            <span className="text-cyan-500">under an hour.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          {STEPS.map((step) => (
            <div key={step.number} className="flex gap-5">
              <div className="shrink-0 w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <span className="text-xs font-black text-cyan-400 font-mono">{step.number}</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-white mb-2">{step.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed mb-3">{step.description}</p>
                {step.code && (
                  <code className="text-xs bg-navy-900/80 border border-white/10 rounded-lg px-3 py-2 block font-mono text-cyan-300">
                    {step.code}
                  </code>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
