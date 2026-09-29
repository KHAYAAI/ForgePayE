'use client';

import { PageHeader, Panel, Grid2 } from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Help — concept reference, out of the operational pages.
   Every dashboard screen shows only what's happening right now;
   the mechanics behind it (how signing quorums work, what a
   dual-mode score is, why a state is empty) live here instead of
   as recurring paragraphs on pages people load every day.
   ──────────────────────────────────────────────────────────────── */

function Entry({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ fontWeight: 500, fontSize: 14.5, marginBottom: 6 }}>{term}</div>
      <p className="lede" style={{ fontSize: 13.5 }}>{children}</p>
    </div>
  );
}

export default function HelpPage() {
  return (
    <>
      <PageHeader
        eyebrow="FORGE / Help"
        title={
          <>
            How <em>FORGE</em> works
          </>
        }
        lede="Concept reference for every product, out of the way of the pages you use daily. Look here when you need the mechanics behind a number or a state — not on the page itself."
      />

      <Panel title="About This Console" label="general behavior across every page" style={{ marginBottom: 20 }}>
        <Entry term="Empty states are real, never fabricated">
          A page that shows zero, a blank table or a dash (—) is reporting the real state of your
          account or of a backend service — never a placeholder standing in for activity that
          hasn't happened. If a service is unreachable, the pages that depend on it (Custody,
          Wallet, Enterprise Treasury, Agent Credit Bureau) show that real empty state instead of
          invented numbers. Check System Health for what's actually reachable right now.
        </Entry>
        <Entry term="Live vs demo data">
          The "live data" / "demo data" pill in a page header tells you whether that page is
          reading its backend service right now. Demo fixtures only render when a service is
          offline, and are visually marked as such.
        </Entry>
      </Panel>

      <Grid2>
        <Panel title="Agent Credit Bureau" label="credit &amp; reputation for autonomous agents">
          <Entry term="Score factors & explainability">
            Factors are the top reasons for an agent's score, ranked by model weight — the same
            explainability a lender sees on a pulled report.
          </Entry>
          <Entry term="Hard inquiries are credit events">
            Every $2.80 pull against an agent's file is itself a credit event: it's on the file,
            visible to the agent's operator, and disputable under the FCRA-style process in
            Disputes.
          </Entry>
          <Entry term="Dual-mode scoring (Mode 1 / Mode 2)">
            Mode 1 (FORGE FICO, off-chain) always makes the lending decision. Mode 2 (operational,
            Qova-derived) exists to catch what a credit file can't: an agent whose on-book profile
            looks healthy but whose live operational behavior — failure rates, budget breaches —
            has deteriorated. When Mode 2 hasn't yet settled, consensus reports MEDIUM and Mode 1
            stands alone as authoritative.
          </Entry>
          <Entry term="On-chain settlement">
            Settled Mode 2 scores are readable by any external protocol — the bureau's audit trail
            without exposing the underlying credit file. Settlement runs on a schedule; the FICO
            file never leaves FORGE.
          </Entry>
          <Entry term="Disputes (FCRA-style process)">
            An operator disputes an event, the furnisher gets 30 days to substantiate it, and an
            unanswered dispute deletes the event from the file. Scores recompute the moment a
            dispute resolves. The dispute and its resolution are themselves recorded as credit
            events — the file records that it was contested — and furnishers who repeatedly post
            corrected data lose contributor query credits.
          </Entry>
          <Entry term="Framework integrations & inquiry volume">
            Score-gated tools (LangGraph, CrewAI, n8n) are how inquiry volume compounds — one agent
            pipeline can pull hundreds of scores a day, each one a metered $2.80 inquiry.
          </Entry>
          <Entry term="Data Contributor Program">
            Contributors (DeFi protocols, CeFi lenders, SaaS platforms, banks) furnish outcome data
            and earn query credits against their own pulls. Contributors start with 5,000 queries;
            capacity grows with every record furnished — the bureau gets richer, the contributor's
            pulls get cheaper.
          </Entry>
        </Panel>

        <Panel title="Payments" label="card, bank and stablecoin behind one API">
          <Entry term="Fallback chains never fail silently">
            A failed payment is never silent: the fallback chain retries card → ACH → USDC before a
            failure surfaces on the Transactions page, and every attempt is recorded as its own
            ontology event.
          </Entry>
          <Entry term="Tier-based routing">
            Payments under $100K route directly through FORGE Wallet. $100K–$1M route through
            FORGE Payments' fallback chain. Above $1M, a payment doesn't fail — the wallet refuses
            with <code>409 route:forge-custody</code> and the router re-submits it to the Custody
            signing queue automatically. Routing is policy, not code — thresholds live in
            Treasury's money-movement rules and apply across every merchant.
          </Entry>
          <Entry term="Disputes & refunds">
            Refunds above R10,000 require a second approver (dual control) — the request routes to
            Compliance before funds move. Lost disputes automatically post a negative event to the
            merchant's ontology record.
          </Entry>
        </Panel>
      </Grid2>

      <Grid2>
        <Panel title="Custody" label="institutional threshold signing" ink>
          <Entry term="MPC signing quorum">
            When a signing request's approval quorum completes, the MPC orchestrator collects
            encrypted shares and the status moves to <code>signing</code> — no human ever touches
            key material. A policy rejection (like <code>DESTINATION_NOT_WHITELISTED</code>) is
            final; resubmission requires a whitelist change, which is itself a governed vote.
            Approvals themselves are signed API calls from registered approver roles; distinct
            approvers are enforced server-side.
          </Entry>
          <Entry term="Governance is a queue, not a say-so">
            Wallet provisioning, signer changes and policy edits are governed changes — they queue
            exactly like transfers and never take effect on a single keyholder's say-so. A newly
            invited signer stays pending until 4 of 7 current signers approve, then serves a
            24-hour cooling-off before their first co-signature counts.
          </Entry>
          <Entry term="Audit log integrity">
            Exports for regulators are one click and cryptographically chained — each row carries a
            hash of the previous, so a removed or altered entry is detectable by anyone holding the
            export.
          </Entry>
          <Entry term="Key ceremonies (DKG / Feldman-VSS)">
            Private keys never exist in plaintext — each key is threshold-encrypted shares dealt in
            a verified DKG ceremony, and rotation re-deals shares without the key ever being
            assembled. Feldman-VSS share commitments are verified at each ceremony, so a corrupted
            or substituted share is detected before it can ever participate in a signature.
          </Entry>
        </Panel>

        <Panel title="Wallet" label="consumer &amp; agent wallets, no seed phrases">
          <Entry term="Corporate wallet governance">
            Creating, renaming or raising the limits of a corporate wallet is a governed change:
            the request queues in Custody and needs sign-off from 2 of 3 senior officers before the
            wallet activates. Payments above a wallet's single-transaction ceiling don't fail —
            they escalate to the Custody signing queue automatically.
          </Entry>
          <Entry term="Social recovery">
            Each trusted contact receives a single-use approval token (hash-stored). Two of three
            approvals unlock a password reset, and keys rotate under the new credential — there's
            no seed phrase to lose in the first place.
          </Entry>
        </Panel>
      </Grid2>

      <Grid2>
        <Panel title="Enterprise Treasury" label="consolidation, netting, agent credit approvals">
          <Entry term="Approving an agent credit extension">
            Approving an extension updates the agent's line in the Agent Credit Bureau and
            authorizes FORGE Custody to settle draws from the enterprise custody account.
            Repayment auto-sweeps principal + fee back on term.
          </Entry>
        </Panel>

        <Panel title="Products & Activation" label="what's on vs off in your console">
          <Entry term="Nothing is pre-selected">
            A new account starts with every product disabled. Only what you enable in Products
            shows up in your console's navigation — a product's pages redirect back to Products if
            you visit them directly without turning it on first. You can change your selection at
            any time.
          </Entry>
        </Panel>
      </Grid2>
    </>
  );
}
