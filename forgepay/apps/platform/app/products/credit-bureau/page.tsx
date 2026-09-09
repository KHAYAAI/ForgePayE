import Link from 'next/link';

/**
 * Forge Credit Bureau product page.
 *
 * The homepage and footer have linked here since they were written; the page
 * did not exist, so both links 404'd.
 *
 * Every figure below is the one the service enforces, not a rate card kept
 * alongside it. The tiers mirror agent-credit-bureau/src/plans.ts, the per-pull
 * prices mirror its VOLUME_BANDS, and the furnisher share mirrors
 * furnisher-comp.ts — including the switch from cash to reciprocity after the
 * first year, which earlier copy omitted and which materially changes what a
 * furnisher is being promised. If the plan table moves, this page moves with it.
 */
export default function CreditBureauProductPage() {
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
        <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 16 }}>📊 Forge Credit Bureau</h1>
        <p style={{ fontSize: 20, opacity: 0.9, maxWidth: 700, margin: '0 auto' }}>
          Credit files for autonomous agents. A traditional FICO-style score and an on-chain
          operational score, side by side, with the variance between them explained.
        </p>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 60, color: 'var(--navy)' }}>
          What&apos;s Included
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
          <FeatureCard
            icon="🎯"
            title="Dual-Mode Scoring"
            description="Mode 1 is FICO-shaped: payment history, utilisation, age, mix, new credit. Mode 2 scores on-chain operational behaviour. Both are returned, never blended into one opaque number."
          />
          <FeatureCard
            icon="🔍"
            title="Variance Explained"
            description="When the two modes disagree, the report says why. A wide gap is a signal about the agent, not noise to be averaged away."
          />
          <FeatureCard
            icon="📄"
            title="Lender Reports"
            description="An underwriting packet issued as a document, retrievable later exactly as issued — a lender that extended credit on a report can produce that report in an audit."
          />
          <FeatureCard
            icon="🔐"
            title="Consent-Gated Pulls"
            description="Every hard inquiry requires a single-use consent token, spent on use and recorded against the inquiry that consumed it."
          />
          <FeatureCard
            icon="⚖️"
            title="Disputes and Clawback"
            description="A disputed event reverses the specific attribution it produced — including the revenue share already earned on it — rather than adjusting an aggregate."
          />
          <FeatureCard
            icon="🕶️"
            title="Zero-Knowledge Mode"
            description="Prove a score is above a threshold, or that there has been no default in N months, without disclosing the underlying history."
          />
        </div>
      </section>

      {/* Pricing */}
      <section style={{ background: 'var(--light-gray)', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, textAlign: 'center', marginBottom: 16, color: 'var(--navy)' }}>
          Pricing
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--text-light)', marginBottom: 60, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
          A subscription plus per-pull pricing. Each plan includes an annual allocation of hard
          pulls; pulls beyond it are charged at the volume band you have reached.
        </p>

        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
          <PlanCard
            name="Observer"
            price="$0"
            bundled="Soft pulls only"
            note="No hard pulls. For monitoring your own agents."
          />
          <PlanCard
            name="Growth"
            price="$1,000/mo"
            bundled="250 pulls/yr included"
            note="For lenders underwriting a growing book."
          />
          <PlanCard
            name="Institutional"
            price="$4,000/mo"
            bundled="2,500 pulls/yr included"
            note="Banks, underwriters and white-label partners."
            highlighted
          />
          <PlanCard
            name="Network"
            price="$12,000/mo"
            bundled="10,000 pulls/yr included"
            note="Platform-scale inquiry volume."
          />
        </div>

        <div style={{ maxWidth: 800, margin: '40px auto 0', background: 'white', borderRadius: 12, padding: 32 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--navy)' }}>
            Pulls beyond your allocation
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <BandRow band="First 5,000/yr" price="$2.80 per pull" />
            <BandRow band="Next 20,000/yr" price="$2.40 per pull" />
            <BandRow band="Beyond 25,000/yr" price="$2.00 per pull" />
          </div>
        </div>
      </section>

      {/* Furnishers */}
      <section style={{ maxWidth: 1000, margin: '0 auto', padding: '100px 40px' }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 24, color: 'var(--navy)' }}>
          For data furnishers
        </h2>
        <p style={{ fontSize: 16, color: 'var(--text-light)', lineHeight: 1.7, marginBottom: 32 }}>
          A furnisher is any party that reports agent credit behaviour into the bureau — a lending
          protocol reporting repayments, a payment rail reporting settlement history. A bureau with
          no furnishers has no file to sell, so furnishers are paid rather than merely thanked.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Year one: cash</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)', lineHeight: 1.6 }}>
              25% of every paid inquiry is shared with the furnishers whose data shaped the score,
              paid in USDC. Attribution is weighted by scoring impact, not by event count — a
              furnisher earns for data that moved the score, not for volume.
            </p>
          </div>
          <div style={{ background: '#f9f9f9', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
            <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>After year one: reciprocity</h4>
            <p style={{ fontSize: 14, color: 'var(--text-light)', lineHeight: 1.6 }}>
              The share converts to inquiry credits at double its cash value — data for data, the
              arrangement traditional bureaus have always run on. Furnishers with no use for credit
              reports can be kept on cash by exception.
            </p>
          </div>
        </div>
      </section>

      {/* Technical */}
      <section style={{ background: 'var(--light-gray)', padding: '100px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontSize: 36, fontWeight: 700, marginBottom: 60, color: 'var(--navy)' }}>
            Technical Architecture
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
            <div style={{ background: 'white', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
              <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Mode 1 — live</h4>
              <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
                Scored in-process on every request, so a pull reflects the file as it stands rather
                than as it was last batched.
              </p>
            </div>
            <div style={{ background: 'white', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
              <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Mode 2 — settled on Base</h4>
              <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
                Written to the ForgeReputationRegistry contract on a schedule, in batches. Reports
                carry the transaction hash and block of the score they quote.
              </p>
            </div>
            <div style={{ background: 'white', padding: 24, borderRadius: 12, borderLeft: '4px solid var(--cyan)' }}>
              <h4 style={{ marginBottom: 12, color: 'var(--navy)' }}>Sanctions screening</h4>
              <p style={{ fontSize: 14, color: 'var(--text-light)' }}>
                Run at report time, not read from a cached profile flag, and fails closed: an
                unreachable screening service produces a decline, never a silent pass.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', textAlign: 'center', padding: '80px 40px', borderRadius: 12, margin: '60px 40px' }}>
        <h2 style={{ color: 'white', marginBottom: 24 }}>Underwrite agents with a real credit file</h2>
        <p style={{ fontSize: 18, opacity: 0.95, marginBottom: 32, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
          Start on Observer at no cost to see the data model, then move to a paid tier when you
          need hard pulls.
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

function PlanCard({
  name, price, bundled, note, highlighted = false,
}: {
  name: string; price: string; bundled: string; note: string; highlighted?: boolean;
}) {
  return (
    <div style={{
      background: 'white',
      padding: 28,
      borderRadius: 12,
      border: highlighted ? '2px solid var(--cyan)' : '1px solid #eee',
    }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--navy)' }}>{name}</h3>
      <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--cyan)', marginBottom: 8 }}>{price}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dark)', marginBottom: 8 }}>{bundled}</p>
      <p style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.5 }}>{note}</p>
    </div>
  );
}

function BandRow({ band, price }: { band: string; price: string }) {
  return (
    <div style={{ background: '#f9f9f9', padding: 16, borderRadius: 8 }}>
      <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 4 }}>{band}</p>
      <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy)' }}>{price}</p>
    </div>
  );
}
