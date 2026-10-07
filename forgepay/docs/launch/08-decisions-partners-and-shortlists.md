# Decisions made, and who to approach (bank, payments, security review)

**6 October 2026.** The owner answered the open decisions from `06`. This records them, what each changes, and gives starting lists for a
bank partner, a payments partner and an independent review firm. **Nothing here has been sent to anyone, and I cannot contact, hire or
vet a firm.** The lists are leads from public sources and general knowledge, not recommendations or endorsements. Whether any of them
will take FORGE on is theirs to decide; check each one's current services, availability and references yourself.

## Decisions and what they change

| # | Decision | What it changes |
|---|---|---|
| 1 | **Microfinance institutions fund agent credit lines, through the API. FORGE is only a bureau.** | FORGE holds no loan book. The agent-stack pieces that pretend to move lending money (credit lines, liquidity moves, escrow-as-lender) leave the launch path and stay off and labelled. The product to harden is the **MFI integration**: MFIs report repayments in (furnisher API), pull reports out (lender API), consent, disputes. See "What the bureau-only decision means" below. |
| 2 | **Tokenised assets: let the user choose the issuer. No yield protocol first.** | No default issuer, and FORGE does not pick one. Build an issuer adapter interface and let a user connect the issuer they use; yield stays off. |
| 3 | **Wallets: non-custodial for now, custodial later.** | **A real finding, below:** the wallet as built is not non-custodial. For now, "bring your own wallet" is the honest product. |
| 4 | **Payments: partner now, own licence later.** | Launch payments through a licensed partner's model; keep the licence application as a later project. Leads below. |
| 5 | **Bank partner and review firm: owner asked for help finding them.** | Shortlists below. |
| 6 | **AWS region and accounts: not answered yet.** | Recommendation below; please confirm. |

## Three findings the decisions surface

### 1. The wallet as built is not non-custodial

`open-privy` wraps each user's key under an AWS KMS key that FORGE's own service can call. That protects against a database leak, but it
means FORGE's infrastructure can decrypt and sign. Whether that is "custody" for licensing is counsel's call, but it is plainly not
non-custodial in the sense users and regulators mean. Options:

- **Now (recommended): bring your own wallet.** Users connect a wallet they control; the agent's DID is bound to that address (the bureau
  already derives identity from an address). FORGE never holds a key. Keep `open-privy` switched off until the custodial licence exists.
- **Later, still non-custodial:** keys held on the user's device (passkey-backed) or a threshold scheme where the user's device holds a share.
  That is new cryptographic work and needs its own independent review.
- **Custodial later:** the existing design, after the licence and a review.

### 2. The bureau-only decision may bring the National Credit Act into play

A search of the regulator's pages shows the NCR requires a **credit bureau** to register, and says it will not register one if a person
with a controlling interest in it is a **credit provider**. Microfinance institutions are credit providers. Two consequences to put to counsel:

- Do **not** give MFIs a controlling stake in FORGE, and keep their role to customer/furnisher.
- MFIs reporting on credit to a bureau may be allowed to do so only to a **registered** bureau. If the National Credit Act applies to the
  credit these MFIs give to agents, registration may be a condition of their participation. The existing counsel brief (`02`, question 5) asks
  whether scoring agents (not people) keeps FORGE outside bureau registration. **Sharpen that question now**, because the MFI plan makes it
  central: the agent is software, but its operator is a legal person, and some MFI borrowers may be natural persons behind the operator.

### 3. A bank partner is not what the bureau soft launch needs

The bureau is paid in USDC and pays furnishers in USDC. It does not hold customer money in rand. For the soft launch you need:

- an **operating business bank account** for fees and expenses, and
- if you want rand, a **licensed ZAR to USDC on/off ramp**.

A **settlement bank partner** (payouts to merchants, treasury settlement) is for the payments and treasury products, which come later.

## Bank and payments partners: where to look

**Context from public sources.** The big banks closed crypto-exchange accounts in 2020 (FNB, Nedbank, Absa, Standard Bank, per press); the
Reserve Bank's 15 August guidance note later told banks not to de-risk crypto firms wholesale; the FSCA has licensed hundreds of crypto asset
service providers (248 in one announcement, with more in the pipeline); and Nedbank announced a March 2026 partnership with Crypto.com to offer rand
and on-chain USDC settlement, phased from individuals to businesses over twelve months. The direction is more open than it was, but a bank decides
on your anti-money-laundering programme, so expect questions before an account.

| Need | Names to look at | Why they are on the list | What to check |
|---|---|---|---|
| **Operating account, with an API** | **Investec** (business banking) | Publishes developer APIs for account information and payment initiation | Whether it will bank a company whose revenue is stablecoin; its requirements for crypto-adjacent clients |
| | **Nedbank** | Announced a crypto settlement partnership in 2026, so it has shown appetite | Whether that reaches a company like yours, and when |
| | Standard Bank, FNB, Absa | Large banks; all three have de-risking history | Current policy toward FSCA-licensed or crypto-adjacent clients |
| **ZAR to USDC on/off ramp** | **Yellow Card** | Reported an FSCA CASP licence, focused on stablecoin rails for businesses | Whether it serves a bureau's flows and its B2B terms |
| | VALR, Luno and other FSCA-listed CASPs | Established local exchanges | Confirm the licence on the FSCA's published list; check each one's business offering |
| **Payments partner (the "partner's licence" route)** | **Fincra** | Reported to hold a South African payment provider licence working with Nedbank, with collections and payouts through one API | Whether its model fits a merchant-of-record or settlement role |
| | **Ozow** | Instant EFT; reported API-based account-to-account payments with FNB and RMB | Whether payouts are offered, and to whom |
| | Peach Payments, Stitch, Paystack, PayFast | Well-known South African payment providers (not checked in this search) | Their current licences and whether Hyperswitch has a connector for the one you pick |

**What a bank or payments partner will ask for** (prepare this once):

- Company registration, directors and beneficial owners, and your FIC Act position (accountable institution or not: counsel's answer).
- A short anti-money-laundering and sanctions programme: the compliance monitor, screening lists, who your compliance officer is.
- What you do with money: the bureau's flow of funds in one page (customers pay USDC to the gateway, swept to your wallet, furnishers paid out), the
  conservative limits (`04`), and who approves payouts.
- Your FSCA status or counsel's written opinion that you do not need it.
- Independent review status, once you have it.

## Independent review firms

**What to buy, and in what order** (`01-review-engagement.md` and `docs/security-review/07-rfp.md` have the detail):

- **Scope A** (gateway, bureau billing, console, deployment): needed before the bureau takes real money. Application and cloud security.
- **Scope B** (threshold signer, custody governance, recovery): needed before custody. Applied cryptography.
- Wallets: if you build the later device-held option, it is a third, small cryptographic scope.

Two different skills, so two quotes are normal; one firm can bid both if it has both teams.

**A point for the scope B brief.** The signer uses `github.com/bnb-chain/tss-lib/v2` at `v2.0.0`. Threshold-signature libraries of this family
have had published implementation vulnerabilities (one public disclosure came from a joint review by io.finnet and Kudelski Security). Ask the
reviewer to state which known advisories affect that exact version and to check that our usage avoids them. This is a question for a specialist,
not something I can settle.

| For | Firms with relevant published work (from public sources) | Note |
|---|---|---|
| **Scope B: threshold signing** | **Kudelski Security**: audited Binance's tss-lib, ING's threshold ECDSA library and others | The library FORGE's signer is built on is one they have already read closely |
| | **Trail of Bits**: five-week review of a threshold-signature library (DKLs23) with published findings | Strong cryptography group; check lead times |
| | **Least Authority**: audited Safeheron's multiparty ECDSA | Published reports |
| | **Cure53**: audited a TSS(2,2) ECDSA library | Published reports; also strong on web application security |
| | HashCloak, Secfault Security | Named among firms that reviewed an MPC wallet project |
| | Verichains | Published research on attacks against MPC wallets (named in the RFP) |
| **Scope A: application and cloud** | **Cure53**, **NCC Group**, **Trail of Bits** | The RFP's list; confirm each firm's current availability |
| | Blockchain-focused firms (OpenZeppelin, Zellic, Halborn, Spearbit and others) | Strong where smart contracts or custody logic dominate; here most of the money path is TypeScript services and key handling |
| | A South African firm for a penetration test of the deployed environment | Ask your counsel, your bank and your insurers for names; I have none verified |

**How to choose** (aim for three quotes per scope):

1. Send the same package under NDA after the freeze steps in `01`.
2. Ask for named reviewers, two or three **published** reports on similar work, price and what it includes (a retest of fixes should be in it), earliest start,
   report format, and who else sees findings.
3. Prefer a firm that read the package before quoting. Treat a quote with no questions, or an "automated scan" as the main deliverable, as a warning.
4. Check for independence: the firm must not have built, sold or invested in any part of what it reviews.
5. Expect weeks to book and four to six weeks to review. Budget time to fix findings and have them re-checked before launch.

## AWS: recommendation

- **Accounts:** a separate staging account and production account now. Add a third, separate backup account when custody comes, so the people and
  hosts that hold backups are not the ones that run the nodes.
- **Region:** `af-south-1` (Cape Town) keeps South African customers' data nearby and is the repo's default staging region, but it is opt-in, costs more, and
  has fewer services. If your counsel is comfortable with data leaving South Africa under POPIA, `eu-west-2` (London) is simpler and cheaper.
  CloudFront's certificate must be in `us-east-1` either way. **Please confirm which one.**

## Your next steps (this week)

1. **Counsel first.** Send `02-counsel-brief.md` with the sharpened question from finding 2 and a new one: is the "bring your own wallet" model outside custody rules? They set the pace for everything else.
2. **Approach two banks and one on/off ramp** with the pack above. Ask the bank what it needs to open a business account for a company whose revenue is stablecoin.
3. **Pick a payments partner** from the list and ask what their licence covers and what they require of you. Check whether Hyperswitch has a connector for them.
4. **Request scope A quotes from three firms**, and a scope B quote from at least two of Kudelski, Trail of Bits, Least Authority and Cure53.
5. **Confirm the AWS region and accounts**, then open the staging account (see `07`).

## Built since (7 October)

- **Bring your own wallet** (console, *Agent Credit Bureau > Connect wallet*): the user connects a wallet they control and signs one message that names the address, the agent and
  the workspace. The console recovers the signature server-side, so a browser cannot claim an address it does not control; a challenge is single-use, lasts ten minutes, and is
  bound to the workspace. The agent is then registered under the self-certifying identity `did:forge:0x<address>`, so the bureau holds an agent whose address was **proven**, not
  typed in. FORGE never sees a key and the signature moves no funds. Checked end to end: a different wallet's signature is refused (and does not spend the challenge), another
  workspace cannot use the challenge, a replay is refused, and the bureau holds the agent at 300 / DEEP_SUBPRIME. The hosted `open-privy` wallet stays off.
- **The lender and furnisher API for institutions** (keys, sandbox, published contract, conformance script, operator-issued consent): see `09-institution-integration-guide.md`.
- **Unlaunched lending code** is still in the repo but off and labelled; nothing in the console offers it.

## What I can build next, given these decisions

- Take the credit lines, liquidity and lender-style escrow off every customer-facing surface, and mark them "not offered" in the console and docs.
- Per-institution request quotas and webhooks for the lender and furnisher API (keys, sandbox, contract and consent are built).
- An issuer adapter interface for tokenised assets, with no default issuer.
- A payments-partner adapter for whichever you choose (once chosen and checked against Hyperswitch's connectors).

## Sources

Public pages used for the leads above: Nedbank and Crypto.com partnership (BusinessTech, March 2026); Fincra's payment provider licence with Nedbank;
Ozow with FNB and RMB (TechAfrica, 2026); Investec's developer and API banking pages; the FSCA's licensing of crypto asset service providers
(Finance Magnates, Moonstone) and Yellow Card's CASP licence (several outlets); Reserve Bank guidance on crypto asset service providers (Mariblock);
bank account closures (ITWeb); the NCR's credit bureau registration pages and section 43 of the National Credit Act; Kudelski Security's tss-lib review and its
research page; the io.finnet and Kudelski disclosure; Least Authority's Safeheron report; Cure53's Silence Laboratories report. Details were not checked beyond the search summaries.
