import Link from 'next/link';

export default function FAQPage() {
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
        <h1 style={{ fontSize: 42, fontWeight: 700, marginBottom: 16, color: 'var(--navy)' }}>Frequently Asked Questions</h1>
        <p style={{ fontSize: 18, color: 'var(--text-light)' }}>Everything you need to know about ForgePay</p>
      </section>

      {/* FAQ */}
      <section style={{ maxWidth: 800, margin: '0 auto', padding: '0 40px 100px' }}>
        <FAQItem
          question="What's the difference between Mode 1 and Mode 2 credit scoring?"
          answer="Mode 1 scores an agent from the records its data furnishers report, using a published rule-based formula (not a trained model). Mode 2 is meant to score on-chain activity; it runs on testnet only today and most agents have no on-chain history yet."
        />

        <FAQItem
          question="Can I take payments with FORGE?"
          answer="Not yet. Payments launch only after licensing. Today the Credit Bureau is the only product opening, to early-access partners, billed in USDC."
        />

        <FAQItem
          question="Can I use just one product, or must I subscribe to all three?"
          answer="Only the Credit Bureau is available today. Payments, Treasury, Custody and Wallet will each open separately when they are ready."
        />

        <FAQItem
          question="How are subscriptions billed?"
          answer="The Credit Bureau is prepaid: you top up in USDC and each report draws down your balance, or you take a monthly plan. See the Credit Bureau pricing for current figures."
        />

        <FAQItem
          question="Is there a setup fee?"
          answer="No setup fee. Early-access partners agree terms with us directly."
        />

        <FAQItem
          question="Do you offer an SLA?"
          answer="Not yet. We will agree service levels with early-access partners once we have run the service in production long enough to stand behind a number."
        />

        <FAQItem
          question="Can I regenerate my API key?"
          answer="Yes. Go to Settings > API Keys and click 'Regenerate'. It is shown once. The old key immediately becomes invalid."
        />

        <FAQItem
          question="How do I monitor churn risk?"
          answer="This is not offered yet."
        />

        <FAQItem
          question="Do you offer onboarding support?"
          answer="Yes. Early-access partners work with us directly during onboarding."
        />

        <FAQItem
          question="What about PCI compliance?"
          answer="Card payments are not live. When they are, card data will be tokenised in the payment engine's vault and never stored by FORGE. We hold no PCI DSS or ISO 27001 certification today."
        />
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--navy)', color: 'white', textAlign: 'center', padding: '40px' }}>
        <p>Still have questions? <a href="mailto:support@myforgepay.com" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>Email support</a></p>
      </footer>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid #eee' }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: 'var(--navy)' }}>{question}</h3>
      <p style={{ color: 'var(--text-light)', lineHeight: 1.7 }}>{answer}</p>
    </div>
  );
}
