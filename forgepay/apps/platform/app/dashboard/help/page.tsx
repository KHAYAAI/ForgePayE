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
        <Panel title="Custody" label="policy screening and signer quorum" ink>
          <Entry term="What happens to a transfer">
            Every transfer, whether requested here or by a connected application, is checked
            against policy first: sanctions lists, amount limits for your tier, and any whitelist
            or blocked countries you have set. A denial is final and recorded. Transfers over
            10 ETH are then held until a quorum of your signers approves; smaller ones are signed
            straight away.
          </Entry>
          <Entry term="Quorum">
            Your threshold is how many signers must approve. If you have fewer eligible signers
            than the threshold, every current signer must approve instead. Each signer can vote
            once; as soon as enough rejections make approval impossible, the transfer is rejected
            and never signed.
          </Entry>
          <Entry term="Adding and removing signers">
            The first signer sets the workspace up. Every signer after that is proposed and
            approved by the existing signers, then waits out a cooling-off period (24 hours by
            default) before their vote counts. Removing a signer, or changing the threshold, is
            a proposal too.
          </Entry>
          <Entry term="How the signing key works">
            Each workspace has its own key, split into shares held by separate signing nodes; any
            two of three sign together and the whole key is never assembled. Your approvals decide
            whether a transfer is sent for signing, and each node rebuilds the transaction and can
            refuse on its own limits. If too few nodes are online, an approved transfer is held as
            &ldquo;approved &middot; not signed&rdquo; and can be retried. In the development
            cluster all nodes share one host, which the Keys page says outright. Separate hosts are
            needed before the split protects anything.
          </Entry>
          <Entry term="Connected applications">
            An application connects with its own named API key. It can submit transfers through
            the same policy checks and approval queue as the console. Keys are shown once when
            issued, record when they were last used, and can be revoked individually.
          </Entry>
        </Panel>

        <Panel title="Wallet" label="consumer &amp; agent wallets, no seed phrases">
          <Entry term="One wallet per chain">
            Each account holds one wallet per chain (Ethereum, Polygon, Solana). The private key
            is generated on the server and stored encrypted (AES-256-GCM) under a key derived for
            your account — it is never shown to anyone, including you.
          </Entry>
          <Entry term="Social recovery">
            Instead of a seed phrase, you add trusted contacts. Recovering access takes approvals
            from two of them.
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
