# FORGE: platform capabilities brief (for content creation)

**Prepared 2 November 2026 from the ForgePay codebase.** This is the source brief for anyone, human or AI, creating content about FORGE:
web pages, decks, social posts, explainer graphics, product visuals. Every capability below exists in the code unless it is marked otherwise.
Read section 2 before writing anything: it says what may and may not be claimed.

---

## 1. FORGE in one paragraph

FORGE is financial infrastructure for the agentic age. As AI agents start buying, paying and borrowing on their own, nobody can yet answer the
question a lender asks first: *does this agent pay what it owes?* FORGE answers it. Its first product is a **credit bureau for AI agents**:
lenders and microfinance institutions check an agent's score before extending credit, and report repayments back so the score stays true.
Underneath sits a single ledger where every payment, on every rail (card, bank, stablecoin, machine payment), becomes one signed event, so a
lender, a treasurer and an auditor all read the same history.

**Tagline:** The Revenue Ontology.
**Supporting lines (from the current site):** "Every form of value. One platform." / "The asset becomes a parameter." / "The financial
infrastructure company for the agentic age."

---

## 2. Truth rules (read first)

FORGE is **pre-launch**. Content must not suggest otherwise.

**Always true, safe to say**
- FORGE is building the credit bureau for AI agents; it is the first product to launch.
- The capabilities in section 4 exist in the product's code and are tested.
- Five smart contracts are deployed on **Base Sepolia, a test network** (not mainnet).
- The stack is built with security-first practices: signed and scanned releases, deploys only by exact image fingerprint, human approval for every payout.

**Never say or imply**
- That any product is **live**, generally available, or has customers, users, volume, revenue or partners. None of these exist yet.
- That FORGE has processed real money. It has processed none.
- That FORGE **lends**, offers **credit lines**, holds funds in **escrow**, or moves agents' **liquidity**. These were built and then
  switched off **by decision**: FORGE is a bureau. Lenders fund credit and carry the risk; FORGE scores and reports. (The current website
  still lists "Negotiation & Escrow", "Liquidity Manager" and "Agent Credit Lines"; do **not** reuse that copy.)
- That agents "borrow autonomously, no human approval required". Not offered.
- That FORGE holds customers' wallet keys. Wallets are **bring your own**; the hosted-wallet design is off.
- That anything is "audited", "certified", "regulated", "licensed" or "compliant with" a named law. No independent review or regulatory
  approval has happened yet.
- Invented statistics, market sizes, testimonials, logos, or named customers.

**Use these status labels when a status is needed**
| Label | Use for |
|---|---|
| **Launching first** | Credit Bureau |
| **In development** | Compliance Monitor, Stablecoin Gateway, Console (they launch with the bureau) |
| **Testnet / pilot** | FORGE Custody |
| **Coming later** | FORGE Payments, FORGE Treasury |
| **Coming soon** | General call to action ("Join the waitlist", "Talk to us") |

Any page or post that mentions availability should carry: *"FORGE is in development and not yet available. Features described may change."*

---

## 3. Audiences

| Audience | What they want | Message |
|---|---|---|
| **Lenders, microfinance institutions, credit marketplaces** | To extend credit to AI agents without guessing | "Know an agent before you lend to it." |
| **Companies running AI agents (operators)** | Access to credit and services for their agents; a reputation that travels | "Give your agent a credit history." |
| **Developers and protocols** | A clean API, sandbox, signed webhooks | "One request in. A verifiable score out." |
| **Finance teams and merchants** (later products) | One ledger across every rail | "Every form of value, one history." |
| **Investors** | A new category: credit infrastructure for machine actors | "The bureau for the agent economy." |

---

## 4. Capabilities, product by product

### 4.1 FORGE Credit Bureau: launching first

**What it is.** A credit bureau for AI agents. It scores an agent (and the company behind it) on whether it pays what it owes, and gives lenders a
signed report before they extend credit.

**How the score works: two modes**
- **Mode 1: reported history.** Lenders ("furnishers") report repayments: paid, late, missed. A rules engine turns that history into a score.
- **Mode 2: on-chain behaviour.** FORGE reads the agent's own wallet activity on **Base, Ethereum and Solana** (finalised transactions only),
  and can use signed spend statements from FORGE Custody.
- Together they produce a score from **0 to 1000**, shown as a familiar letter grade:

| Grade | Score from | Risk | Meaning |
|---|---|---|---|
| AAA | 950 | Minimal | Exceptional track record, highest trust |
| AA | 900 | Very low | Excellent history, very reliable |
| A | 850 | Low | Strong performance, trustworthy |
| BBB | 750 | Moderate | Good standing, investment grade |
| BB | 650 | Notable | Fair record, room for improvement |
| B | 550 | Elevated | Adequate but limited history |
| CCC | 450 | High | Below average, caution advised |
| CC | 350 | Very high | Poor record, significant risk |
| C | 250 | Severe | Very poor, near default |
| D | 0 | Critical | Default risk, avoid |

AAA to BBB are "investment grade". The grade colours run from deep green (AAA) through yellow (BB) to deep red (D).

**Built-in protections and features**
- **Consent first.** A lender can only pull a report with **single-use consent** issued by the agent's operator for that lender.
- **Verified operators.** The company behind an agent is checked against a company register before it can be scored.
- **Wallet proof.** An operator binds an agent's wallet by signing a challenge, proving control, on Base, Ethereum or Solana.
- **Per-institution keys** for every lender, each with its own **rate limit** and **daily pull cap**.
- **Signed webhooks.** When an agent's grade changes, every lender that reported on it gets a signed notification.
- **Disputes.** An operator can dispute a wrong record; it is flagged while under review.
- **Sanctions screening** on every report; if screening is unavailable the bureau refuses rather than guesses.
- **Billing per report**, like a traditional bureau. (Configured inquiry fee: US$2.80 per pull; treat as indicative, not a published price.)
- **Lender sandbox** with synthetic data, and an integration guide, API specification and conformance checks for developers.

**Why it matters (value)**
- Lenders get a signal where none exists today, and pay only for the reports they pull.
- Good agents earn a portable reputation; operators can show a track record.
- The bureau never lends, so it stays neutral: it does not compete with its customers.

### 4.2 Compliance Monitor: launches with the bureau

**What it is.** The screening layer under every product.
- Screens people, companies and wallet addresses against **OFAC (US), EU, UN, UK and South African** sanctions lists.
- **Fails closed:** until the lists are loaded and fresh (less than 72 hours old), it answers "error", never "clear".
- Transaction monitoring rules (structuring, large transactions, high-risk countries).
- Drafts suspicious-activity and cash-threshold reports for a compliance officer to review (drafts, never automatic filings).

**Message:** "Nothing moves until it is screened."

### 4.3 Stablecoin Gateway: launches with the bureau

**What it is.** How FORGE gets paid and pays out in stablecoins, starting with **USDC on Base**.
- A unique deposit address per payment; only the **exact** amount is credited. Late payments are flagged, never silently accepted.
- **x402 machine payments:** an agent can pay for a service in a single HTTP request, with no card and no human.
- Sweeps deposits to the company's operating wallet; daily reconciliation against the chain.
- Payouts need a **person to approve** them (not the person who requested them), within hard per-payout and daily caps; payouts can only go to
  listed recipients.
- Payouts can be signed by FORGE Custody, so no single machine holds a full key.

**Message:** "Agents pay in one request. Every cent reconciles."

### 4.4 Console: launches with the bureau

**What it is.** The web app where customers work with FORGE.
- Operators sign up, verify their company, and bind their agent's wallet (bring your own wallet).
- Lenders onboard, manage API keys and pull reports.
- Screens for custody attestations and treasury approvals.

### 4.5 FORGE Custody: testnet and pilots

**What it is.** Key custody for businesses and agents using **threshold signatures**: a payment needs **2 of 3 key shares**, held on separate
machines, so no single server can ever move funds.
- Supports **ECDSA and Ed25519** chains (Ethereum-family and Solana-family).
- Policies and multi-person approvals before anything is signed.
- An **agent-payments API** with idempotency: a retried request never pays twice.
- **Signed attestations** of an agent's spend history that the bureau can verify and use in its score.

**Message:** "No single key. No single point of failure."
**Status note:** testnet and capped pilots only; not independently audited yet.

### 4.6 FORGE Payments: coming later

**What it is.** Checkout across cards, bank transfers, stablecoins and x402, built on an open-source payment router core (Hyperswitch).
- Merchant-of-record tax handling, subscriptions and invoicing.
- Every sale, on any rail, becomes the same signed **ForgePayEvent**.
- Will launch through a licensed payment partner; it has not processed real payments.

### 4.7 FORGE Treasury: coming later

**What it is.** One cash position across bank accounts and wallets, with netting and multi-person approvals.
Settlement, yield and tokenised-asset execution are **not built yet**; do not describe them as features.

### 4.8 The shared foundation: the ledger

- **ForgePayEvent:** one signed record shape for every payment, payout, score change and attestation, whatever the rail.

```
ForgePayEvent {
  id:        "evt_01J..."
  rail:      "card" | "bank" | "usdc" | "x402"
  amount:    { value: "25.00", asset: "USDC" }
  party:     { agent: "did:forge:...", operator: "org_..." }
  screening: "clear"
  signature: "ed25519:..."
}
```
- Because every product writes to it, reconciliation, audit and reporting work the same way across rails.
- **On-chain:** five FORGE contracts (reputation registry, transaction validator, budget enforcer, core, cross-chain reputation) are deployed on
  the **Base Sepolia test network**. Not on mainnet.

### 4.9 How it is built (trust story)

Safe to describe, all true today:
- Every release is **scanned** for vulnerabilities and embedded secrets, then **cryptographically signed**.
- Deploys accept only signed images, by exact fingerprint (digest), through short-lived credentials, after a **human approves**.
- Services **refuse to start** with a missing or placeholder secret.
- Money-moving defaults are conservative: small caps, human approval, recipient lists.
- Sanctions screening fails closed.

---

## 5. User journeys (good for explainers, carousels, animations)

**1. A lender checks an agent before lending**
1. The operator signs up in the Console; their company is checked against a company register.
2. They bind the agent's wallet by signing a challenge.
3. They grant single-use consent naming this lender.
4. The lender pulls the report with its own key.
5. FORGE reads the agent's on-chain history alongside its repayment record.
6. The operator and wallet are screened for sanctions.
7. The lender gets the score, grade and a signed report, and is notified if the grade changes later.

**2. A lender reports repayments**
1. The lender reports paid, late or missed payments.
2. Each record is written to the ledger as a signed event.
3. The agent's score is recalculated.
4. Every lender that reported on the agent is notified of a grade change.
5. The operator can dispute a wrong record.

**3. An agent pays for a service in USDC**
1. The service answers with a machine payment request and a unique deposit address.
2. The paying wallet is screened.
3. The exact amount arrives on Base and is confirmed.
4. The payment is recorded and reconciled.
5. The service is released.

**4. A payout through FORGE Custody** (testnet)
1. A payout is requested within conservative limits.
2. A person other than the requester approves it.
3. It goes to Custody with a key that prevents double payment.
4. Two of three key shares sign it together.
5. It settles on Base and is reconciled.
6. Custody signs a statement of spend history that strengthens the agent's score.

**5. A merchant takes a payment** (coming later)
1. A customer pays by card, bank or stablecoin.
2. Card and bank payments route to a licensed partner.
3. The sale becomes one signed event, with tax handled.
4. Treasury sees it beside every other balance.

---

## 6. Brand and visual system

- **Colours:** Navy `#0A2540` (primary ground), Cyan `#00F0FF` (accent, used sparingly for emphasis, data highlights and calls to action).
  Supporting: deep ink `#04121F`, raised navy `#0F3157`, sky `#5CC8FF`, amber `#FFB547` (warnings, "in development"), coral `#FF7A86` (off / risk).
  Grade colours (green to red) only when showing scores.
- **Type:** Inter for everything; a monospace (e.g. IBM Plex Mono) for data, code, event records and labels.
- **Tone:** plain, confident, exact. Short sentences. Name real things (grades, consent, signed events, 2-of-3). No hype words
  ("revolutionary", "game-changing"), no emoji as decoration.
- **Motifs that fit:** a single glowing ledger at the centre with products orbiting it; streams of events normalising into one record; a
  0–1000 score dial with letter grades; three key shards where two must meet to sign; the ForgePayEvent code block as a visual.
- **Existing asset:** an interactive 3D "platform world" page (products as districts around the ledger, playable user journeys) can be used as
  a reference for layout and motion.

---

## 7. Content angles (ideas)

- "Who checks the agent?": the gap a bureau fills as agents start transacting.
- "Consent before credit": how a lender's pull works, step by step.
- "From 0 to 1000": what moves an agent's score, and what each grade means.
- "One request in": x402 machine payments explained.
- "No single key": 2-of-3 threshold custody in one picture.
- "Every form of value, one record": the ForgePayEvent.
- "Built to refuse": fail-closed screening, human-approved payouts, signed releases.
- "Why a bureau, not a lender": FORGE's neutral position.

---

## 8. Glossary

| Term | Plain meaning |
|---|---|
| Agent | Software that acts and transacts on its own, run by a company (its operator) |
| Operator | The company responsible for an agent |
| Furnisher | A lender that reports repayment data to the bureau |
| Pull / report | A lender requesting an agent's score and history |
| Consent token | Single-use permission from the operator for one lender's pull |
| Mode 1 / Mode 2 | Score from reported repayments / score from on-chain activity |
| ForgePayEvent | FORGE's single signed record for any financial event |
| x402 | A standard for paying for a web request with a stablecoin, inside the request itself |
| Threshold signature (2-of-3) | A signature only produced when two of three separately held key shares cooperate |
| Fail closed | When unsure or unable to check, refuse instead of allowing |
| Base / Base Sepolia | A blockchain network / its public test network |

---

## 9. Standard disclaimer

> FORGE is in development and not yet available. No product is live and no customer funds have been processed. Features, availability and
> pricing may change. FORGE is a credit reporting and infrastructure provider; it does not lend money.
