# ForgePay — FCA Cryptoasset Business Registration

**Document type:** Separate from PI application — MLR 2017 Regulation 14A Registration  
**Applicant:** ForgePay Ltd  
**Legal basis:** Money Laundering, Terrorist Financing and Transfer of Funds (Information on the Payer) Regulations 2017 (SI 2017/692), as amended by The Money Laundering and Terrorist Financing (Amendment) Regulations 2019 (SI 2019/1511)  
**FATF references:** FATF Recommendation 15 (VASPs); Recommendation 16 (Travel Rule)  
**Prepared:** 25 June 2026  
**Version:** 1.0  
**Owner:** MLRO / Compliance Officer  

---

## 1. Overview

ForgePay's payment platform includes services involving **cryptoassets** — specifically:

| Service | Cryptoassets | Registration Required? |
|---|---|---|
| USDC payment acceptance and settlement | USDC (USD Coin) | Yes — stablecoin is a cryptoasset under MLR 2017 |
| USDT payment acceptance and settlement | USDT (Tether) | Yes |
| Bitcoin payment acceptance | BTC | Yes |
| Ethereum payment acceptance | ETH | Yes |
| Litecoin payment acceptance | LTC | Yes |
| Monero payment acceptance | XMR | Yes — heightened scrutiny expected |
| x402 AI agent micropayments | USDC (primarily) | Yes (via USDC) |

Under **MLR 2017 Regulation 14A** (inserted by the 2019 Amendment Regulations), any firm carrying on **cryptoasset business** in the UK must register with the FCA **before** carrying on that business. Conducting unregistered cryptoasset business is a criminal offence under MLR 2017 reg 86.

> **Critical timeline note:** The FCA's Cryptoasset Registration review period is notoriously lengthy — averaging 12–18 months as at 2025/2026, with rejection rates of approximately 80% at initial application stage. ForgePay must submit this application as early as possible and **must not** commence cryptoasset services until registration is confirmed.

---

## 2. Definition of Cryptoasset Business

MLR 2017 reg 14A(1) defines cryptoasset business as including:

| Cryptoasset Activity | Description | ForgePay Applicability |
|---|---|---|
| Exchange services | Exchanging cryptoassets for fiat money (and vice versa) | Yes — USDC/USDT/BTC/ETH/LTC/XMR to GBP/USD conversion |
| Exchange between cryptoassets | Exchanging one cryptoasset for another | Not primary service — review if crypto-to-crypto swaps offered |
| Operating a cryptoasset ATM | N/A | No |
| Peer-to-peer exchange services | Facilitating cryptoasset transfers between users | Partial — ForgePay routes crypto payments |
| Issuing new cryptoassets (ICOs etc.) | N/A | No |
| Transfer services | Facilitating the transfer of cryptoassets | Yes — all crypto payment services |

**ForgePay's registration covers:** Exchange services (crypto-to-fiat) and transfer services (facilitating crypto payments).

---

## 3. FCA Cryptoasset Registration — Application Requirements

The FCA requires the following for Cryptoasset Registration under MLR 2017 Reg 14A:

### 3.1 Application Form

Submitted via **FCA Connect**. Key sections:

| Section | Content |
|---|---|
| Applicant details | ForgePay Ltd details; Companies House number |
| Business description | Description of each cryptoasset activity to be carried on |
| Beneficial owners | UBOs of ForgePay; source of funds |
| Officers and directors | Full details of all directors; fitness and propriety |
| Financial crime controls | Full AML/CFT policy, procedures, and systems |
| Risk assessment | Crypto-specific ML/TF risk assessment |
| Customer due diligence | CDD/EDD for crypto customers |
| Transaction monitoring | Crypto-specific transaction monitoring |
| Travel Rule | Compliance arrangements for FATF R.16 / UK TFR |
| Wallet screening | Tools and processes for screening blockchain addresses |
| Systems and controls | IT security, record keeping, blockchain analytics tools |

### 3.2 Application Fee

| Activity | Fee (2025/26) |
|---|---|
| Up to 5 cryptoasset activities | £10,000 |
| 6+ cryptoasset activities | £10,000 + £1,000 per additional activity |

ForgePay estimates **2–3 cryptoasset activities** (exchange services + transfer services), so the fee is £10,000.

The FCA's application fee is **non-refundable** regardless of outcome.

### 3.3 Supporting Documents Required

- [ ] AML Policy (crypto-specific sections) — see `07_aml_policy.md`
- [ ] Crypto-specific risk assessment (BWRA — cryptoasset section)
- [ ] Transaction monitoring procedures (crypto-specific rules and tools)
- [ ] Travel Rule compliance arrangements (TRISA / OpenVASP)
- [ ] Wallet screening tool evidence (Chainalysis Reactor, TRM Labs, or equivalent)
- [ ] Evidence of financial crime controls for each cryptoasset handled
- [ ] XMR-specific enhanced controls documentation
- [ ] Directors' CVs and fitness and propriety evidence
- [ ] Business plan (cryptoasset activities)
- [ ] Financial projections (cryptoasset revenue and costs)
- [ ] Evidence of initial capital adequate to cover cryptoasset business costs

---

## 4. The FCA's Assessment Approach for Cryptoasset Registration

The FCA assesses cryptoasset registration applications against a **very high standard of financial crime controls**. Key assessment criteria:

### 4.1 Financial Crime Risk Assessment

The FCA expects applicants to demonstrate:
- A comprehensive understanding of the ML/TF risks specific to each cryptoasset they deal in
- Risk assessments updated for emerging threats (DeFi, NFTs, mixers, privacy coins)
- Clear risk appetite statement for high-risk cryptoassets (XMR specifically)

**ForgePay's position on XMR:** Given Monero's privacy-enhancing characteristics (ring signatures, stealth addresses, RingCT), ForgePay acknowledges elevated ML/TF risk and applies the enhanced controls set out in `07_aml_policy.md` Section 9. The FCA may question whether XMR acceptance is compatible with adequate AML controls — ForgePay should be prepared to defend its XMR controls or restrict/remove XMR services to facilitate registration.

### 4.2 Customer Due Diligence

The FCA expects crypto-specific CDD covering:
- Identification and verification of payers (where applicable under Travel Rule thresholds)
- Source of funds verification for large crypto transfers
- Screening of blockchain wallet addresses for illicit activity (not just entity screening)

### 4.3 Systems and Controls

The FCA expects demonstration of:
- **Blockchain analytics tools** (Chainalysis, TRM Labs, Elliptic, or equivalent) for wallet screening
- **On-chain transaction monitoring** (not just fiat transaction monitoring)
- Integration of blockchain intelligence into the AML engine

### 4.4 Rejection Risk Factors

FCA commonly rejects applications for:
- Inadequate AML policies (generic policies not tailored to crypto risk)
- Lack of blockchain analytics tooling
- Acceptance of privacy coins (XMR) without adequate controls
- Management team lacking crypto AML experience
- Insufficient financial crime resources (understaffed AML team)
- Unresolved concerns about UBO/controller fit and propriety

---

## 5. Crypto-Specific AML Controls

### 5.1 Blockchain Analytics and Wallet Screening

ForgePay will implement **blockchain analytics tooling** before processing any cryptoasset payments:

| Tool | Purpose | Cryptoassets |
|---|---|---|
| [Chainalysis Reactor / KYT] | Wallet address risk scoring; transaction graph analysis | BTC, ETH, LTC, USDC, USDT |
| [TRM Labs / Elliptic] | Secondary wallet screening; cross-chain analytics | ETH, Polygon, Solana (USDC) |
| [Monero-specific tooling if available] | XMR address screening (limited capability) | XMR |

**Wallet screening process:**
1. On receipt of a crypto payment instruction, the payer's wallet address is screened before transaction execution
2. Addresses flagged as **high risk** (mixer, darknet market, OFAC sanctions) block the transaction
3. Addresses flagged as **medium risk** are queued for MLRO review within 4 hours
4. Results are logged in the AML case management system

### 5.2 On-Chain Transaction Monitoring

In addition to ForgePay's 8-rule AML engine (which monitors fiat equivalents), ForgePay will implement on-chain monitoring:

| Monitoring Signal | Action Threshold |
|---|---|
| Transaction involves known mixer/tumbler address | Block + MLRO alert |
| Peel chain / chain hopping pattern | MLRO alert; enhanced review |
| Darknet market associated wallet | Block + SAR consideration |
| Sanctions-listed wallet (OFAC SDN on-chain) | Block + OFSI report |
| Unusual transaction velocity for given wallet | MLRO alert |
| Transaction amount at or near Travel Rule threshold (structuring) | MLRO alert |

### 5.3 Crypto Customer Risk Scoring

Crypto merchant risk scoring adds the following factors to the standard merchant risk score:

| Factor | Risk Adjustment |
|---|---|
| Accepts XMR only | +3 (minimum High risk) |
| Accepts multiple privacy coins | +2 |
| High crypto volume relative to fiat (>80% of volume) | +1 |
| Crypto exchange / VASP business | +2 |
| DeFi protocol or smart contract interaction | +1 |
| Jurisdictions with weak VASP regulation (FATF grey list) | +2 |
| Regulated crypto business in recognised jurisdiction (e.g., FCA-registered) | -1 |

---

## 6. FATF Recommendation 15 — VASP Controls

FATF Recommendation 15 requires countries to ensure VASPs are regulated for AML/CFT purposes. The UK implements R.15 through MLR 2017 Reg 14A (registration) and the substantive AML requirements.

ForgePay's obligations as a registered UK VASP:
- Implement risk-based AML/CFT controls proportionate to crypto risk
- Conduct CDD on all customers (as per MLR 2017 reg 28)
- Apply EDD to high-risk customers including PEPs and those in high-risk jurisdictions
- Screen transactions against sanctions lists
- File SARs to NCA where ML/TF is suspected
- Comply with the Travel Rule (see Section 7)

---

## 7. Travel Rule Compliance (FATF Recommendation 16)

### 7.1 UK Travel Rule

The **Transfer of Funds (Information on the Payer) Regulations 2017** as amended by The Money Laundering and Terrorist Financing (Amendment) (No.2) Regulations 2022 implements FATF R.16 for cryptoasset transfers.

**Key requirements:**
- For crypto transfers ≥ £1,000 (or equivalent) between VASPs: transmit originator and beneficiary information
- Originators must collect and verify: originator name, originator account identifier (wallet address), originator geographic address OR national identity number OR customer ID OR date/place of birth
- Beneficiaries must collect and screen incoming Travel Rule data
- For transfers < £1,000: collect but need not verify information
- For transfers to **unhosted wallets** ≥ £1,000: collect additional information; enhanced CDD may be required

### 7.2 Technical Implementation

ForgePay will implement Travel Rule compliance using an industry-standard protocol:

**Preferred protocol:** TRISA (Travel Rule Information Sharing Architecture) — open standard, FATF-compatible

**Implementation steps:**
1. Integrate with a Travel Rule compliance provider (e.g., Notabene, Sygna Bridge, or direct TRISA integration)
2. Implement originator data collection in merchant checkout flows
3. Implement beneficiary data verification for incoming transfers
4. Test data exchange with counterparty VASPs before going live
5. Document data exchange records for audit trail (5-year retention)

### 7.3 Unhosted Wallet Procedures

For transfers to/from unhosted (self-custodied) wallets ≥ £1,000:

1. Collect beneficiary/originator name and wallet address (mandatory)
2. Apply a **blockchain analytics screen** on the wallet address
3. For transfers ≥ £3,000: apply EDD — request evidence of wallet ownership (digital signature challenge or statement of address)
4. High-risk patterns (e.g., funds received from mixer then to unhosted wallet) trigger SAR consideration

### 7.4 VASP Counterparty Due Diligence

Before establishing a Travel Rule data exchange relationship with another VASP, ForgePay will conduct VASP due diligence:
- Confirm the counterparty VASP is registered/licensed in its home jurisdiction
- Assess the counterparty's AML/CFT controls (FCA guidance and FATF expectations)
- Refuse data exchange with VASPs in FATF blacklisted jurisdictions
- Enhanced monitoring for VASPs in FATF grey list jurisdictions

---

## 8. Stablecoins — Regulatory Framework

### 8.1 Current UK Regulatory Position (as at June 2026)

The Financial Services and Markets Act 2023 (FSMA 2023) provides HM Treasury with powers to bring **stablecoins used as payment means** into the FCA's regulatory perimeter. As at June 2026:
- USDC and USDT used as payment instruments are **not yet** subject to the FCA's full stablecoin payment regime (commencement expected 2026/27)
- They remain subject to **MLR 2017 Reg 14A** as cryptoassets
- ForgePay monitors HMT / FCA developments on stablecoin regulation and will apply for any additional permissions required when the regime commences

### 8.2 ForgePay's Stablecoin Policy (Interim)

Until the FCA's stablecoin payment regime applies:
- USDC and USDT are treated as cryptoassets for MLR 2017 purposes
- Full CDD, transaction monitoring, and Travel Rule procedures apply
- Settlement in stablecoins is offered only to merchants who have passed enhanced KYB

### 8.3 MiCA Alignment

While ForgePay is a UK firm subject to UK law (not EU MiCA), ForgePay aligns with key MiCA controls as best practice:
- Using only MiCA-compliant or well-regulated stablecoin issuers (Circle for USDC; Tether has limitations)
- Monitoring stablecoin reserve adequacy disclosures
- Not accepting algorithmic or unbacked stablecoins

---

## 9. Monero (XMR) — Regulatory Considerations

### 9.1 FCA Stance

The FCA has not explicitly prohibited Monero acceptance but has expressed concern about **privacy-enhanced cryptocurrencies** (PECs) in its registration guidance. Multiple FCA-registered crypto firms have voluntarily removed XMR support to facilitate registration.

### 9.2 ForgePay's Approach

ForgePay acknowledges that XMR acceptance may be the **single largest barrier** to FCA Cryptoasset Registration approval. ForgePay's strategy:

**Option A (Recommended for initial registration):** Launch without XMR support. Apply for registration with BTC/ETH/LTC/USDC/USDT only. Add XMR after registration and a documented risk assessment reviewed by the FCA.

**Option B:** Include XMR in the initial application with the full enhanced controls documented in `07_aml_policy.md` Section 9. This risks a longer review or refusal. Suitable only if XMR is critical to the initial business case.

**Decision:** [Board to decide prior to submission]

### 9.3 XMR Risk Acceptance

If XMR is included, the MLRO and Board must sign a formal **XMR Risk Acceptance Statement** documenting:
- The ML/TF risks identified
- The controls implemented
- The residual risk accepted
- The trigger that would cause XMR service withdrawal

---

## 10. Application Timeline

Given the FCA's documented processing times for Cryptoasset Registration:

| Month | Activity |
|---|---|
| 0 | Begin application preparation; engage specialist crypto AML counsel |
| 0–2 | Draft crypto risk assessment, AML controls documentation, Travel Rule implementation plan |
| 1–2 | Procure and integrate blockchain analytics tooling (Chainalysis / TRM Labs) |
| 2 | Submit Cryptoasset Registration application via FCA Connect |
| 2–14 | FCA review period (12 months is typical; budget 18 months) |
| 3–14 | FCA queries — respond within deadlines |
| 14+ | Registration granted; commence cryptoasset services |
| 14+ | Submit Travel Rule compliance evidence to FCA |

**Total timeline from application to operational: 14–24 months**

> ForgePay will not commence any cryptoasset services until FCA registration is confirmed in writing.

---

## 11. Post-Registration Obligations

Upon FCA Cryptoasset Registration, ForgePay's ongoing obligations include:

| Obligation | Description | Frequency |
|---|---|---|
| FCA RegData reporting | Annual report on cryptoasset business activities and volumes | Annual |
| AML policy review | Review and update crypto AML policy | Annual + on change |
| Blockchain analytics subscription maintenance | Maintain current and effective analytics tooling | Ongoing |
| Travel Rule compliance review | Ensure coverage of all counterparty VASPs; test new integrations | Quarterly |
| FCA notification of material change | Notify FCA of new cryptoassets added, changes to controls | On change |
| Fit and proper annual assessment | Refresh F&P of registered individuals | Annual |
| JMLSG Guidance updates | Monitor and implement updated JMLSG crypto guidance | On publication |
| FATF typologies review | Review NCA / FATF annual reports for emerging crypto typologies | Annual |

---

## 12. Key Regulatory Contacts for Cryptoassets

| Contact | Details |
|---|---|
| FCA Cryptoasset Registration team | cryptoasset.registration@fca.org.uk |
| FCA Cryptoasset Supervision | Via FCA Connect (post-registration) |
| NCA (SAR reporting for crypto) | SAR Online portal: sars.nationalcrimeagency.gov.uk |
| OFSI (sanctions matches) | ofsi@hmtreasury.gov.uk |
| FATF guidance | www.fatf-gafi.org (VASP guidance, R.15, R.16 interpretive notes) |
| JMLSG cryptoassets guidance | www.jmlsg.org.uk (Part III, Sector 22 — Cryptoasset businesses) |
| UK Travel Rule guidance | FCA Policy Statement PS22/10; www.fca.org.uk |

---

*Document version: 1.0 — 25 June 2026*  
*Owner: MLRO / Compliance Officer*  
*Submitted as a separate application from the PI authorisation application*  
*Review: Prior to submission; annual post-registration*
