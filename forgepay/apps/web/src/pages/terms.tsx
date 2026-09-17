/**
 * ARCH: Terms of Service — new page.
 * ──────────────────────────────────────────────────────────────────────────────
 * DRAFT, same status as privacy.tsx — see that file's header comment for why
 * the on-page banner is deliberate and must stay until real legal review.
 *
 * Deliberately takes NO position on whether the National Credit Act applies
 * to this product (open question, see docs/LAUNCH_RUNBOOK.md Step 1) --
 * Section 3 describes current, actual product behavior (which operator
 * types are accepted today) without asserting a legal conclusion either way.
 * Section 6 states real, verified facts about testnet vs. production status
 * rather than a blanket uptime/reliability promise the company can't back.
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

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-forge-bg">
      <Navbar />

      <div className="pt-32 pb-24 px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">// LEGAL</p>
          <h1 className="text-3xl font-mono font-bold text-white mb-4 tracking-tight">
            Terms of Service
          </h1>
          <p className="text-xs font-mono text-[#6B7280] mb-8">
            Draft — last updated {new Date().toISOString().slice(0, 10)}
          </p>

          <div className="border border-[#F59E0B] bg-[#F59E0B0D] px-5 py-4 mb-12">
            <p className="text-xs font-mono text-[#F59E0B] leading-relaxed">
              <strong>This is a working draft, not a finalized legal document.</strong> It
              accurately reflects how the platform currently works, but it has not been reviewed
              by a qualified attorney and should not be relied on as a final, binding contract
              until that review is complete.
            </p>
          </div>

          <Section id="acceptance" title="1. Acceptance of these terms">
            <p>
              By registering for or using any ForgePay product — FORGE Credit Bureau, our payment
              rails, or any other service described on our{' '}
              <a href="/platform" className="text-[#39D353] underline">platform page</a> — you
              agree to these terms. If you're acting on behalf of an organization, you're
              confirming you have authority to bind that organization.
            </p>
          </Section>

          <Section id="service" title="2. What we provide">
            <p>
              Our products are at different stages of maturity, and we describe them honestly as
              such. FORGE Credit Bureau and our stablecoin/crypto payment rails have been verified
              end-to-end on Base Sepolia testnet, including real, confirmed on-chain transactions.
              Other products on our platform page are in active development and are not yet
              production-verified in the same way. We'll be explicit, on each product's own page,
              about which category it's in.
            </p>
          </Section>

          <Section id="eligibility" title="3. Eligibility and operators">
            <p>
              An AI agent has no legal personality of its own. Every agent registered with FORGE
              Credit Bureau is bound to an operator — the person or entity legally and financially
              responsible for it. As the product currently works, an operator may be registered as
              an individual, an LLC, a corporation, or a DAO.
            </p>
            <p>
              We make no representation here about whether any particular jurisdiction's consumer
              credit or financial services regulation applies to a given operator or use case —
              that determination depends on your jurisdiction, your operator's structure, and how
              you use the product, and is your responsibility to assess. We may, in the future,
              restrict which operator types can register in some or all jurisdictions; if we do,
              we'll update this section and notify registered users.
            </p>
          </Section>

          <Section id="accounts" title="4. Accounts and API credentials">
            <p>
              You're responsible for safeguarding your API keys and any credentials issued to you.
              An API key is shown in full exactly once at creation and is stored by us only as a
              hash — if you lose it, we cannot recover it, and you'll need a new one issued. You're
              responsible for activity that occurs under your credentials.
            </p>
          </Section>

          <Section id="fees" title="5. Fees and billing">
            <p>
              Subscription plans and pay-as-you-go pricing for FORGE Credit Bureau are published on
              its <a href="/products/credit-bureau" className="text-[#39D353] underline">product page</a>{' '}
              and may change with notice. Furnishers earn a fixed 25% of the list inquiry price on
              every report their data informed, paid automatically in USDC — that share does not
              change based on any volume discount the buyer receives.
            </p>
            <p>
              Payouts made via our stablecoin rails are broadcast on-chain and are irreversible once
              confirmed — see Section 8. We do not reverse a correctly-executed on-chain payout.
            </p>
          </Section>

          <Section id="acceptable-use" title="6. Acceptable use">
            <p>You agree not to: use the platform to evade sanctions or facilitate transactions with a sanctioned party; submit false or fraudulent operator, registration, or transaction information; attempt to circumvent our sanctions screening or other compliance controls; or use the platform for any purpose that violates applicable law.</p>
            <p>Every report issued by FORGE Credit Bureau is screened against sanctions lists before it issues, and fails closed — if the screening service is unreachable, no report is issued. We may suspend or terminate access for any account we reasonably believe is violating this section.</p>
          </Section>

          <Section id="crypto-risk" title="7. Cryptocurrency and blockchain risk">
            <p>You acknowledge and accept the following, specific to using blockchain-based payment rails:</p>
            <p><strong className="text-white">Irreversibility</strong> — a confirmed on-chain transaction cannot be reversed by us, by you, or by anyone. Sending funds to the wrong address, or an incorrect amount, is not something we can undo.</p>
            <p><strong className="text-white">Volatility</strong> — the value of cryptocurrencies and stablecoins can fluctuate, and a stablecoin's peg is not guaranteed by us.</p>
            <p><strong className="text-white">Network and gas costs</strong> — transactions require network fees that vary and are outside our control.</p>
            <p><strong className="text-white">Smart contract risk</strong> — our on-chain contracts have been built and tested carefully, but no smart contract is risk-free, and a bug or exploit — ours or in infrastructure we depend on — could result in loss of funds.</p>
            <p><strong className="text-white">Regulatory uncertainty</strong> — the legal treatment of cryptocurrency, stablecoins, and AI-agent financial activity is evolving and varies by jurisdiction, and may change in ways that affect this service.</p>
          </Section>

          <Section id="disclaimer" title="8. Disclaimer of warranties">
            <p>
              The platform is provided "as is" and "as available." Products described as in active
              development on our <a href="/platform" className="text-[#39D353] underline">platform page</a>{' '}
              carry no uptime or reliability commitment. Even for our verified products, we do not
              guarantee uninterrupted or error-free operation. To the maximum extent permitted by
              law, we disclaim all warranties, express or implied.
            </p>
          </Section>

          <Section id="liability" title="9. Limitation of liability">
            <p>
              To the maximum extent permitted by law, ForgePay will not be liable for indirect,
              incidental, special, or consequential damages, or for any loss of funds resulting
              from an on-chain transaction you initiated, a compromised private key or credential
              on your end, or your use of a product explicitly marked as in-development.
            </p>
          </Section>

          <Section id="termination" title="10. Termination">
            <p>
              We may suspend or terminate access for violation of these terms, suspected fraud, a
              sanctions match, or as required by law. You may stop using the platform at any time.
              Obligations that by their nature should survive termination — including furnisher
              payout obligations already earned, and confidentiality — will survive.
            </p>
          </Section>

          <Section id="governing-law" title="11. Governing law and disputes">
            <p>
              These terms are intended to be governed by the laws of South Africa, subject to final
              confirmation as part of our legal review. We'll update this section once that review
              is complete.
            </p>
          </Section>

          <Section id="changes" title="12. Changes to these terms">
            <p>
              We may update these terms as the platform evolves. We'll post the updated date at the
              top of this page and, for material changes, make reasonable efforts to notify
              registered users directly.
            </p>
          </Section>

          <Section id="contact" title="13. Contact">
            <p>
              Questions about these terms can be sent via the details on our{' '}
              <a href="/contact" className="text-[#39D353] underline">contact page</a>.
            </p>
          </Section>
        </div>
      </div>

      <Footer />
    </main>
  );
}
