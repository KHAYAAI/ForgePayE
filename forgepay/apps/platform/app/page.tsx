import Link from 'next/link';

export default function Home() {
  return (
    <div>
      {/* Navigation */}
      <nav style={{ position: 'fixed', top: 0, width: '100%', background: 'rgba(255, 255, 255, 0.98)', borderBottom: '1px solid #eee', padding: '16px 40px', zIndex: 1000 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)' }}>
            Forge<span style={{ color: 'var(--cyan)' }}>Pay</span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <Link href="/products/payments" style={{ textDecoration: 'none', color: 'inherit', fontWeight: 500, fontSize: 14 }}>
              Products
            </Link>
            <Link href="/faq" style={{ textDecoration: 'none', color: 'inherit', fontWeight: 500, fontSize: 14 }}>
              FAQ
            </Link>
            <Link href="/case-studies" style={{ textDecoration: 'none', color: 'inherit', fontWeight: 500, fontSize: 14 }}>
              Case Studies
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/auth/login" className="btn-secondary">
              Sign In
            </Link>
            <Link href="/auth/signup" className="btn-primary">
              Start Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', padding: '160px 40px 100px', textAlign: 'center', marginTop: 60 }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h1 style={{ fontSize: 56, fontWeight: 700, marginBottom: 20, lineHeight: 1.2 }}>
            Payment & Credit <span style={{ background: 'linear-gradient(90deg, var(--cyan) 0%, #00D4FF 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Infrastructure</span>
          </h1>
          <p style={{ fontSize: 20, opacity: 0.95, marginBottom: 40 }}>
            Process payments, manage treasury, and build credit—unified in one platform.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/auth/signup" style={{
              padding: '14px 32px',
              background: 'var(--cyan)',
              color: 'var(--navy)',
              borderRadius: 8,
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
            }}>
              Start Free Trial
            </Link>
            <Link href="/products/payments" style={{
              padding: '14px 32px',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              borderRadius: 8,
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
              border: '2px solid var(--cyan)',
            }}>
              View Demo
            </Link>
          </div>
        </div>
      </section>

      {/* Products Preview */}
      <section style={{ padding: '100px 40px', maxWidth: 1400, margin: '0 auto' }}>
        <h2 style={{ fontSize: 42, fontWeight: 700, textAlign: 'center', marginBottom: 60, color: 'var(--navy)' }}>
          Three Products, One Platform
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32 }}>
          <ProductCard icon="💳" title="Forge Payments" price="R15,000/mo" description="Card and bank transfer processing with intelligent fallback routing." href="/products/payments" />
          <ProductCard icon="💰" title="Forge Treasury" price="R40,000/mo" description="Multi-agent payout netting, OFAC screening, and FX optimization." href="/products/treasury" />
          <ProductCard icon="📊" title="Forge Credit Bureau" price="R8,500/mo" description="Dual-mode credit scoring with FICO and on-chain operational modes." href="/products/credit-bureau" />
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', textAlign: 'center', padding: '80px 40px', borderRadius: 12, margin: '60px 40px' }}>
        <h2 style={{ color: 'white', marginBottom: 24 }}>Ready to Transform Your Payment Stack?</h2>
        <p style={{ fontSize: 18, opacity: 0.95, marginBottom: 32, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
          Join 50+ early adopters processing millions in GMV on ForgePay.
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
          Start Your Free Trial
        </Link>
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--navy)', color: 'white', padding: '60px 40px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 40, marginBottom: 40 }}>
          <div>
            <h4 style={{ color: 'var(--cyan)', marginBottom: 16 }}>Product</h4>
            <ul style={{ listStyle: 'none' }}>
              <li><Link href="/products/payments" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>Payments</Link></li>
              <li><Link href="/products/treasury" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>Treasury</Link></li>
              <li><Link href="/products/credit-bureau" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>Credit Bureau</Link></li>
            </ul>
          </div>
          <div>
            <h4 style={{ color: 'var(--cyan)', marginBottom: 16 }}>Resources</h4>
            <ul style={{ listStyle: 'none' }}>
              <li><Link href="/faq" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>FAQ</Link></li>
              <li><Link href="/case-studies" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>Case Studies</Link></li>
              <li><Link href="/docs" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>Docs</Link></li>
            </ul>
          </div>
          <div>
            <h4 style={{ color: 'var(--cyan)', marginBottom: 16 }}>Company</h4>
            <ul style={{ listStyle: 'none' }}>
              <li><Link href="/about" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>About</Link></li>
              <li><Link href="/contact" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>Contact</Link></li>
              <li><a href="mailto:support@forgepay.co.za" style={{ color: 'rgba(255, 255, 255, 0.7)', textDecoration: 'none' }}>Support</a></li>
            </ul>
          </div>
        </div>
        <div style={{ textAlign: 'center', paddingTop: 40, borderTop: '1px solid rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.6)', fontSize: 13 }}>
          <p>© 2026 ForgePay (Pty) Ltd. All rights reserved. | Johannesburg, South Africa</p>
        </div>
      </footer>
    </div>
  );
}

function ProductCard({ icon, title, price, description, href }: { icon: string; title: string; price: string; description: string; href: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{ background: 'white', borderRadius: 12, padding: 40, border: '2px solid #eee', transition: 'all 0.3s', cursor: 'pointer' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
        <h3 style={{ marginBottom: 8, fontSize: 22, color: 'var(--navy)' }}>{title}</h3>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--cyan)', margin: '16px 0' }}>{price}</div>
        <p style={{ color: 'var(--text-light)', fontSize: 15 }}>{description}</p>
      </div>
    </Link>
  );
}
