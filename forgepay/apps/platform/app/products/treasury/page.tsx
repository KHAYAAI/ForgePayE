import Link from 'next/link';

/**
 * Forge Treasury product page.
 *
 * The homepage and footer have linked here since they were written; the page
 * did not exist, so both links 404'd.
 *
 * Capabilities described below are the ones enterprise-treasury actually
 * exposes — cash consolidation, the rules engine and its approval queue,
 * intercompany netting, the FX cache, and the agent tool surface. Nothing here
 * describes a feature the service does not have.
 */
export default function TreasuryProductPage() {
  return (
    <div>
      {/* Navigation */}
      <nav style={{ position: 'fixed', top: 0, width: '100%', background: 'rgba(255, 255, 255, 0.98)', borderBottom: '1px solid #eee', padding: '16px 40px', zIndex: 1000 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between' }}>
          <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)', textDecoration: 'none' }}>
            Forge<span style={{ color: 'var(--cyan)' }}>Pay</span>
          </Link>
          <Link href="/auth/signup" className="btn-primary">Start Trial</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ padding: '140px 40px 80px', background: 'linear-gradient(135deg, #00D4FF 0%, var(--cyan) 100%)', color: 'var(--navy)', textAlign: 'center', marginTop: 60 }}>
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 16 }}>💰 Forge Treasury</h1>
        <p style={{ fontSize: 20, opacity: 0.9, maxWidth: 700, margin: '0 auto' }}>
          Consolidate 50–300 accounts into one cash position. Net intercompany flows before they
          become wires, and put agent credit decisions behind a CFO approval desk.
        </p>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 60, color: 'var(--navy)' }}>
          What&apos;s Included
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
          <FeatureCard
            icon="🏦"
            title="Cash Consolidation"
            description="One position across every account and subsidiary, refreshed on a schedule rather than assembled by hand at month end."
          />
          <FeatureCard
            icon="⚙️"
            title="Treasury Rules Engine"
            description="Rules evaluate on a continuous cycle and execute sweeps, escrow moves and alerts. Every execution is logged."
          />
          <FeatureCard
            icon="🔀"
            title="Intercompany Netting"
            description="Calculate the net of intercompany flows and settle once, instead of paying a wire fee on each leg."
          />
          <FeatureCard
            icon="✅"
            title="Approval Workflow"
            description="Rules above a threshold queue for sign-off rather than firing. The approval is recorded against the action it authorised."
          />
          <FeatureCard
            icon="💱"
            title="FX Rate Cache"
            description="Refreshed hourly with a static fallback, so a rate provider outage degrades to a stale rate rather than a failed settlement."
          />
          <FeatureCard
            icon="🤖"
            title="Agent Tool Surface"
            description="Treasury operations exposed as tools an AI agent can call, under the same rules and approval gates as a human operator."
          />
        </div>
      </section>

      {/* Pricing */}
      <section style={{ background: 'var(--light-gray)', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, textAlign: 'center', marginBottom: 60, color: 'var(--navy)' }}>
          Pricing
        </h2>
        <div style={{ maxWidth: 800, margin: '0 auto', background: 'white', borderRadius: 12, padding: 40 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--navy)' }}>
                Base Price
              </h3>
              <p style={{ fontSize: 32, fontWeight: 700, color: 'var(--cyan)' }}>R40,000/mo</p>
              <p style={{ color: 'var(--text-light)', fontSize: 13 }}>14-day free trial included</p>
            </div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--navy)' }}>
                Where it pays back
              </h3>
              <p style={{ fontSize: 15, color: 'var(--text-light)', lineHeight: 1.6 }}>
                Wire fees avoided through netting, and treasury staff time not spent assembling a
                position by hand. Both scale with account count.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Technical */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 60, color: 'var(--navy)' }}>
          Technical Architecture
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Background cycles</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
              Rules evaluate every 60 seconds, balances refresh every 15 minutes, FX hourly. A
              stalled cycle is visible rather than silent.
            </p>
          </div>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Bank connectivity</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
              Balances are read through the bank-connectivity service, so adding an institution does
              not change treasury logic.
            </p>
          </div>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Fail-closed configuration</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
              Missing API keys or an unset CORS origin stop the service at boot rather than
              degrading it to accepting any caller.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', textAlign: 'center', padding: '80px 40px', borderRadius: 12, margin: '60px 40px' }}>
        <h2 style={{ color: 'white', marginBottom: 24 }}>See your whole cash position</h2>
        <p style={{ fontSize: 18, opacity: 0.95, marginBottom: 32, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
          Start your 14-day free trial. No credit card required.
        </p>
        <Link href="/auth/signup" style={{
          padding: '14px 32px',
          background: 'var(--cyan)',
          color: 'var(--navy)',
          borderRadius: 8,
          fontWeight: 600,
          textDecoration: 'none',
          display: 'inline-block',
        }}>
          Start Your Trial
        </Link>
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--navy)', color: 'white', textAlign: 'center', padding: '40px' }}>
        <p>Questions? <a href="mailto:support@forgepay.co.za" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>Contact support</a></p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div style={{ background: 'white', padding: 32, borderRadius: 12, border: '1px solid #eee', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--navy)' }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-light)', lineHeight: 1.6 }}>{description}</p>
    </div>
  );
}
