import Link from 'next/link';

export default function CaseStudiesPage() {
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

      {/* Header */}
      <section style={{ padding: '120px 40px 60px', textAlign: 'center', marginTop: 60 }}>
        <h1 style={{ fontSize: 42, fontWeight: 700, marginBottom: 16, color: 'var(--navy)' }}>Case Studies</h1>
        <p style={{ fontSize: 18, color: 'var(--text-light)' }}>How our customers are transforming their payment stacks</p>
      </section>

      {/* Case Studies */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px 100px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32 }}>
          <CaseStudyCard
            title="SnapPay Marketplace"
            challenge="Payment failures at 3% (industry: 0.5%)"
            solution="Implemented ForgePay fallback chain: Stripe → Circle USDC"
            result="Reduced failures to 0.3%, recovered R500K+ in revenue"
            metric="R500K+"
            industry="Marketplace"
          />

          <CaseStudyCard
            title="Umuntu Fintech"
            challenge="50+ agents' daily payouts required 4 hours manual work"
            solution="Deployed ForgePay Treasury with automated netting"
            result="2-minute daily netting, R114K/mo savings in FX + CSM time"
            metric="2 min"
            industry="Fintech"
          />

          <CaseStudyCard
            title="AfroBiz Lender"
            challenge="FICO scores didn't predict on-chain repayment"
            solution="Enabled Mode 2 (on-chain) scoring alongside FICO"
            result="Mode 2 revealed 20% higher predictive power on transaction success"
            metric="+20%"
            industry="Lending"
          />
        </div>
      </section>

      {/* Testimonials */}
      <section style={{ background: 'var(--light-gray)', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, textAlign: 'center', marginBottom: 60, color: 'var(--navy)' }}>
          What Our Customers Say
        </h2>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
          <Testimonial
            text="ForgePay's fallback chain reduced our payment failures from 3% to 0.3%. That's hundreds of thousands in recovered revenue."
            author="Thabo Mthembu"
            title="Founder, SnapPay Marketplace"
          />

          <Testimonial
            text="Netting 50+ agents' daily payouts used to take 4 hours of manual work. ForgePay does it in 2 minutes with better FX rates."
            author="Zama Nkosi"
            title="CFO, Umuntu Fintech"
          />

          <Testimonial
            text="The dual-mode credit scoring revealed that our agents' on-chain activity was a better predictor than FICO. Game changer for risk."
            author="Amara Okafor"
            title="Credit Risk Manager, AfroBiz Lender"
          />
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: 800, margin: '80px auto', padding: '0 40px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 16, color: 'var(--navy)' }}>Ready to Transform Your Stack?</h2>
        <p style={{ fontSize: 18, color: 'var(--text-light)', marginBottom: 32 }}>
          Join 50+ companies already using ForgePay to process millions in GMV.
        </p>
        <Link href="/auth/signup" className="btn-primary">
          Start Your Free Trial
        </Link>
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--navy)', color: 'white', textAlign: 'center', padding: '40px' }}>
        <p>Questions? <a href="mailto:support@forgepay.co.za" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>Contact us</a></p>
      </footer>
    </div>
  );
}

function CaseStudyCard({
  title,
  challenge,
  solution,
  result,
  metric,
  industry,
}: {
  title: string;
  challenge: string;
  solution: string;
  result: string;
  metric: string;
  industry: string;
}) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 32, border: '1px solid #eee' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 20, fontWeight: 600, color: 'var(--navy)' }}>{title}</h3>
        <span style={{ fontSize: 12, background: '#eee', padding: '6px 12px', borderRadius: 20, color: 'var(--text-light)' }}>
          {industry}
        </span>
      </div>

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Challenge</h4>
        <p style={{ fontSize: 14, color: 'var(--text-dark)' }}>{challenge}</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Solution</h4>
        <p style={{ fontSize: 14, color: 'var(--text-dark)' }}>{solution}</p>
      </div>

      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #eee' }}>
        <h4 style={{ fontSize: 13, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Result</h4>
        <p style={{ fontSize: 14, color: 'var(--text-dark)' }}>{result}</p>
      </div>

      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--cyan)' }}>{metric}</div>
    </div>
  );
}

function Testimonial({
  text,
  author,
  title,
}: {
  text: string;
  author: string;
  title: string;
}) {
  return (
    <div style={{ background: 'white', padding: 32, borderRadius: 12, border: '1px solid #eee' }}>
      <p style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-light)', marginBottom: 20, lineHeight: 1.8 }}>
        "{text}"
      </p>
      <div>
        <p style={{ fontWeight: 600, color: 'var(--navy)', marginBottom: 4 }}>{author}</p>
        <p style={{ fontSize: 12, color: 'var(--text-light)' }}>{title}</p>
      </div>
    </div>
  );
}
