/**
 * ARCH: Privacy Policy — new page.
 * ──────────────────────────────────────────────────────────────────────────────
 * DRAFT. This is a real, substantive first draft grounded in what the
 * platform actually collects and does (agent profiles, operator identity
 * fields, sanctions screening, payout addresses, standard web/API logs) --
 * not boilerplate copied from an unrelated template. It is NOT a substitute
 * for review by a POPIA-qualified attorney before publishing, especially
 * given the unresolved question of whether the National Credit Act applies
 * to this product (see docs/LAUNCH_RUNBOOK.md Step 1). The on-page banner
 * below is deliberate and should stay until that review has happened --
 * removing it without an actual legal review would misrepresent this
 * document's status to users.
 */

'use client';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-12 scroll-mt-24">
      <h2 className="text-lg font-mono font-bold text-white mb-4 tracking-tight">{title}</h2>
      <div className="text-sm font-mono text-[#9CA3AF] leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-forge-bg">
      <Navbar />

      <div className="pt-32 pb-24 px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">// LEGAL</p>
          <h1 className="text-3xl font-mono font-bold text-white mb-4 tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-xs font-mono text-[#6B7280] mb-8">
            Draft — last updated {new Date().toISOString().slice(0, 10)}
          </p>

          {/* Draft notice — deliberate, see file header comment */}
          <div className="border border-[#F59E0B] bg-[#F59E0B0D] px-5 py-4 mb-12">
            <p className="text-xs font-mono text-[#F59E0B] leading-relaxed">
              <strong>This is a working draft, not a finalized legal document.</strong> It has
              been written to accurately describe what this platform actually does, but it has not
              been reviewed by a qualified attorney (including for South African POPIA compliance
              specifically). Do not treat it as legal advice or as a final commitment until that
              review is complete.
            </p>
          </div>

          <Section id="overview" title="1. Overview">
            <p>
              This policy describes how ForgePay, Inc. ("ForgePay", "we", "us") collects, uses,
              and protects information across our platform — including FORGE Credit Bureau, our
              stablecoin and crypto payment rails, and the broader agent-financial-infrastructure
              products described on our <a href="/platform" className="text-[#39D353] underline">platform page</a>.
            </p>
            <p>
              Because this platform serves both human account holders and autonomous AI agents
              acting on behalf of a registered operator, this policy covers personal information
              about the humans and entities behind an account — not the agents themselves, which
              are not people and hold no privacy rights of their own.
            </p>
          </Section>

          <Section id="what-we-collect" title="2. What we collect">
            <p><strong className="text-white">Account and operator information</strong> — when you register as a lender, furnisher, or agent operator: legal name, entity type, registration number and country of incorporation (for juristic operators), contact details, and API credentials (stored as a hash, never in recoverable form).</p>
            <p><strong className="text-white">Agent credit data</strong> — for each registered agent: transaction and payment history, credit events, dispute records, and the identity binding (DID) connecting the agent to its operator.</p>
            <p><strong className="text-white">Compliance screening data</strong> — names and identifying details submitted for sanctions and AML screening against OFAC and EU consolidated lists, and the screening results.</p>
            <p><strong className="text-white">Payment and payout information</strong> — blockchain wallet addresses used to receive furnisher revenue share or other payouts, and the resulting on-chain transaction records (which are public by nature of being on a public blockchain — see Section 6).</p>
            <p><strong className="text-white">Technical and usage data</strong> — IP addresses, API request logs, timestamps, and error logs, collected for security, debugging, and abuse prevention.</p>
            <p><strong className="text-white">Billing information</strong> — for subscription customers, billing contact and payment details, processed through our payment infrastructure.</p>
          </Section>

          <Section id="how-we-use" title="3. How we use it">
            <p>We use the information above to: operate the credit bureau and scoring engine; screen every report against sanctions lists before it issues; pay furnishers their revenue share; bill subscribers; detect and prevent fraud or abuse; respond to disputes; and comply with applicable law.</p>
            <p>We do not sell personal information to third parties. We do not use agent credit data for any purpose other than the credit bureau's stated function and the compliance obligations that come with operating one.</p>
          </Section>

          <Section id="legal-basis" title="4. Legal basis for processing">
            <p>
              Where South African data protection law (POPIA) or an equivalent framework applies,
              we process personal information on one or more of: your consent (for example, when
              an agent operator consents to a lender pulling its credit report), performance of a
              contract (billing, service delivery), a legal obligation (sanctions screening,
              regulatory record-keeping), or our legitimate interests (fraud prevention, service
              security) balanced against your rights.
            </p>
          </Section>

          <Section id="sharing" title="5. Who we share it with">
            <p>Lenders who pull a report receive the report contents you've consented to share. Furnishers receive attribution and payout information necessary to pay them correctly. We use infrastructure and cloud service providers to operate the platform, bound by contractual confidentiality obligations. We disclose information where required by law, regulation, or a valid legal process.</p>
          </Section>

          <Section id="blockchain" title="6. Blockchain data is public — a specific note">
            <p>
              Payouts made through our stablecoin rails are broadcast to a public blockchain (Base,
              and others as applicable). Once a transaction is confirmed on-chain, its details —
              amount, sender address, recipient address, and timestamp — are permanently and
              publicly visible to anyone, and cannot be deleted or altered by us or by you. This is
              a fundamental property of how public blockchains work, not a choice we make about
              your data, and it exists outside the deletion rights described in Section 8.
            </p>
          </Section>

          <Section id="cross-border" title="7. International data transfers">
            <p>
              Our infrastructure may process and store data in countries other than the one you're
              in, including outside South Africa. Where this involves personal information subject
              to POPIA, we take steps intended to ensure an adequate level of protection continues
              to apply. This is an area we intend to detail further as our infrastructure and legal
              review mature.
            </p>
          </Section>

          <Section id="retention" title="8. Retention and your rights">
            <p>
              We retain information for as long as necessary to provide the service, meet
              regulatory record-keeping obligations (which can be longer for financial and
              compliance records than for other data), and resolve disputes. Specific retention
              periods per data category are being finalized as part of the legal review referenced
              at the top of this page.
            </p>
            <p>
              Subject to applicable law, you may have the right to access, correct, or request
              deletion of your personal information, object to certain processing, and lodge a
              complaint with the Information Regulator of South Africa or another applicable
              authority. To exercise these rights, contact us using the details in Section 11.
            </p>
          </Section>

          <Section id="security" title="9. Security">
            <p>
              We use technical and organizational measures appropriate to the sensitivity of the
              data involved — including hashing credentials rather than storing them in plaintext,
              access controls, and fail-closed compliance checks that refuse to proceed rather than
              silently skip a required screening step. No system is perfectly secure, and we do not
              claim certifications (such as SOC 2) that we do not currently hold.
            </p>
          </Section>

          <Section id="cookies" title="10. Cookies">
            <p>
              Our website may use essential cookies required for the site to function, and may use
              analytics cookies to understand usage. We will provide a cookie-specific notice and
              controls before deploying anything beyond essential, functional cookies.
            </p>
          </Section>

          <Section id="contact" title="11. Contact and changes">
            <p>
              For privacy questions or to exercise your rights, contact us via the details on our{' '}
              <a href="/contact" className="text-[#39D353] underline">contact page</a>. We'll post
              material changes to this policy here with an updated date.
            </p>
          </Section>
        </div>
      </div>

      <Footer />
    </main>
  );
}
