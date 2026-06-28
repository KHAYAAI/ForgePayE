import Link from 'next/link';

export default function PaymentsProductPage() {
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
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 16 }}>💳 Forge Payments</h1>
        <p style={{ fontSize: 20, opacity: 0.9, maxWidth: 600, margin: '0 auto' }}>
          Card and bank transfer processing with intelligent fallback routing. 99.7% success rate guaranteed.
        </p>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 60, color: 'var(--navy)' }}>
          What's Included
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
          <FeatureCard
            icon="🔄"
            title="Intelligent Routing"
            description="Automatically route payments through Stripe, Circle, or manual wire request. Maximize success rates."
          />
          <FeatureCard
            icon="🛡️"
            title="Fraud Detection"
            description="Real-time fraud detection with machine learning. Protect against chargebacks and disputes."
          />
          <FeatureCard
            icon="📊"
            title="Real-Time Monitoring"
            description="Live dashboard tracking transactions, success rates, settlement times, and fallback usage."
          />
          <FeatureCard
            icon="💳"
            title="PCI Compliant"
            description="All card data tokenized in secure vault. Zero storage of sensitive information."
          />
          <FeatureCard
            icon="⚡"
            title="Instant Settlement"
            description="Most payments settle within 2-3 seconds. Sub-5s settlement SLA guaranteed."
          />
          <FeatureCard
            icon="📱"
            title="Multi-Platform"
            description="SDK for Node.js, Python, Go. REST API for any language. Webhooks for events."
          />
        </div>
      </section>

      {/* Pricing */}
      <section style={{ background: 'var(--light-gray)', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, textAlign: 'center', marginBottom: 60, color: 'var(--navy)' }}>
          Transparent Pricing
        </h2>
        <div style={{ maxWidth: 800, margin: '0 auto', background: 'white', borderRadius: 12, padding: 40 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--navy)' }}>
                Base Price
              </h3>
              <p style={{ fontSize: 32, fontWeight: 700, color: 'var(--cyan)' }}>R15,000/mo</p>
              <p style={{ color: 'var(--text-light)', fontSize: 13 }}>14-day free trial included</p>
            </div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--navy)' }}>
                Typical ROI
              </h3>
              <p style={{ fontSize: 32, fontWeight: 700, color: '#4ECB60' }}>R9,000/mo</p>
              <p style={{ color: 'var(--text-light)', fontSize: 13 }}>Savings at R1M GMV (vs Stripe)</p>
            </div>
          </div>
          <div style={{ background: '#FFF9F0', padding: 20, borderRadius: 8, borderLeft: '4px solid #FFA500' }}>
            <p style={{ color: 'var(--text-dark)', fontSize: 14, marginBottom: 8 }}>
              <strong>Launch Promo:</strong> First 100 customers get 10% off for 3 months (R13,500/mo)
            </p>
          </div>
        </div>
      </section>

      {/* Technical Details */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 60, color: 'var(--navy)' }}>
          Technical Architecture
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Payment Router</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
              Hyperswitch (Rust) powers payment routing with sub-100ms latency. PCI vault for card tokenization.
            </p>
          </div>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Fallback Chain</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
              Primary: Stripe ACH → Fallback 1: Circle USDC → Fallback 2: Manual wire. Automatic activation on failure.
            </p>
          </div>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Reliability</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
              Multi-AZ deployment. Auto-failover. 99.7% uptime SLA. Real-time monitoring & alerts.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', textAlign: 'center', padding: '80px 40px', borderRadius: 12, margin: '60px 40px' }}>
        <h2 style={{ color: 'white', marginBottom: 24 }}>Ready to Process Payments?</h2>
        <p style={{ fontSize: 18, opacity: 0.95, marginBottom: 32, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
          Start your 14-day free trial. No credit card required. Full access to all features.
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

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div style={{ background: 'white', padding: 32, borderRadius: 12, border: '1px solid #eee', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--navy)' }}>
        {title}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-light)', lineHeight: 1.6 }}>
        {description}
      </p>
    </div>
  );
}
