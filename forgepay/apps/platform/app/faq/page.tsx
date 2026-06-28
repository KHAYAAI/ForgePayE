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
          answer="Mode 1 uses traditional FICO-style scoring (40% payment history, 30% volume, 20% age, 10% risk). Mode 2 analyzes on-chain operational metrics (35% success rate, 30% volume, 20% compliance, 15% age). We calculate both and alert you when they diverge significantly (>50 points)."
        />

        <FAQItem
          question="How does the payment fallback chain work?"
          answer="When a payment via Stripe ACH fails (timeout, 5xx error, network issue), we automatically retry via Circle USDC if the customer has a wallet. If both fail, we send a manual payment request (bank wire). This maximizes success rates to 99.7%."
        />

        <FAQItem
          question="Can I use just one product, or must I subscribe to all three?"
          answer="You can subscribe to any combination. Forge Payments is independent. Treasury requires 10+ agents to be cost-effective. Credit Bureau can be standalone or bundled with Treasury for a discount (R45K/mo saves R3.5K)."
        />

        <FAQItem
          question="How are subscriptions billed?"
          answer="All subscriptions are monthly, billed in advance via Kill Bill. We auto-prorate when you upgrade mid-month. For example, upgrading from Payments (R15K) to Treasury (R40K) mid-month will only charge you for the remaining days at the daily rate."
        />

        <FAQItem
          question="Is there a setup fee?"
          answer="No. All products are free to set up. We include 14-day free trials (no credit card required) so you can test before committing."
        />

        <FAQItem
          question="What SLA do you guarantee?"
          answer="99.7% uptime on payment processing, with 24-hour support ticket resolution SLA. Kill Bill sync verification runs hourly to catch any divergences. If we fail to meet SLA, we offer service credits."
        />

        <FAQItem
          question="Can I regenerate my API key?"
          answer="Yes. Go to Settings > API Keys and click 'Regenerate'. We'll email you the new key. The old key immediately becomes invalid."
        />

        <FAQItem
          question="How do I monitor churn risk?"
          answer="The Analytics dashboard tracks 4 signals daily: cancellation requests, API inactivity (7+ days), MRR decline (>20%), and settlement inactivity. We alert your CSM to high-severity signals within 2 hours."
        />

        <FAQItem
          question="Do you offer onboarding support?"
          answer="Yes. All customers get email-based onboarding, video tutorials, and live Intercom chat. For Treasury customers (10+ agents), we include 1 CSM call. For churn risk or high-value customers, we offer manual CSM walkthrough."
        />

        <FAQItem
          question="What about PCI compliance?"
          answer="All card data is tokenized in Hyperswitch's PCI vault. We never store card numbers, CVV, or expiry dates. We're also ISO 27001 certified and POPIA-compliant."
        />
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--navy)', color: 'white', textAlign: 'center', padding: '40px' }}>
        <p>Still have questions? <a href="mailto:support@forgepay.co.za" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>Email support</a></p>
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
