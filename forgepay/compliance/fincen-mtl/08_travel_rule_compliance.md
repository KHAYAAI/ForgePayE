# Travel Rule Compliance
## Funds Transfer Recordkeeping and Information Transmission

**Authority:**
- Traditional transfers: 31 CFR 1010.410 (Funds Transfer Recordkeeping Rule); 31 CFR 1010.410(e) ("Travel Rule")
- Crypto/virtual assets: FinCEN Guidance FIN-2019-G001; FATF Recommendation 15 and Guidance on Virtual Assets
- MSB-specific: 31 CFR 1022.410

---

## Overview

The "Travel Rule" is an informal name for the requirement that financial institutions and MSBs transmit certain identifying information about the originator and beneficiary along with each funds transfer. The rule "travels" with the funds.

For ForgePay, Travel Rule compliance applies in two contexts:

1. **Traditional (fiat) funds transfers** — governed by 31 CFR 1010.410
2. **Virtual asset transfers** — governed by FinCEN's 2019 guidance (extending Travel Rule to virtual currency) and FATF Recommendation 15

---

## Part I: Traditional Funds Transfer Travel Rule (31 CFR 1010.410)

### Threshold

**$3,000 or more** — The Travel Rule applies to transmittal orders for $3,000 or more. (31 CFR 1010.410(f))

This covers ForgePay's ACH, wire transfer, and other fiat transmission services.

### Information Required

**From the Transmittor's Financial Institution (ForgePay as originating MSB):**

ForgePay must collect and retain the following for each transmittal order of $3,000+:

| Field | Requirement |
|-------|-------------|
| Name of transmittor (sender) | Required |
| Account number of transmittor (or other identifier) | Required if applicable |
| Address of transmittor | Required |
| Amount of transmittal order | Required |
| Date of transmittal order | Required |
| Name of recipient's financial institution | Required |
| Name of recipient | Required if included in the transmittal order |
| Account number of recipient (or other identifier) | Required if included |
| Any other specific identifier of the recipient | Required if included |

**Information to Transmit to the Next Financial Institution:**

ForgePay must transmit the following to the next MSB or financial institution in the payment chain:

| Field | Must Transmit |
|-------|--------------|
| Name of transmittor | Yes |
| Account number or identifier | Yes |
| Address of transmittor | Yes |
| Name of transmittor's financial institution (ForgePay) | Yes |
| Amount | Yes |
| Date of transmittal order | Yes |
| Name of recipient | Yes |
| Account number or identifier of recipient | Yes |

### Recordkeeping (31 CFR 1010.410)

ForgePay must retain records of transmittal orders for **5 years** from the date of the order.

For ForgePay as an intermediary (not originator or beneficiary):
- Retain all information received from the prior institution
- Pass that information to the next institution in the chain

---

## Part II: Virtual Asset Travel Rule

### FinCEN's Extension to Virtual Currency

In May 2019, FinCEN issued guidance (FIN-2019-G001) confirming that:
- Convertible virtual currency (CVC) transmitters are money transmitters
- The existing BSA Travel Rule requirements under 31 CFR 1010.410 apply to CVC transactions

This means ForgePay's BTC, ETH, LTC, XMR, USDC, and USDT transactions are subject to Travel Rule requirements.

**Note:** FinCEN proposed a rule in 2020 (NPRM) to lower the Travel Rule threshold for virtual currency to $250 (international) and $3,000 (domestic). As of 2026, monitor FinCEN's rulemaking for the final rule, which may significantly expand ForgePay's Travel Rule obligations.

### FATF Recommendation 15 — Virtual Assets

The Financial Action Task Force (FATF), the global AML standard-setter, adopted Recommendation 15 and updated its guidance on virtual assets. FATF sets the standard that most countries (including the US) implement:

**FATF Threshold: $1,000 USD (or equivalent)**

For virtual asset transfers of $1,000 or more, the originating Virtual Asset Service Provider (VASP) must:
1. Collect the originator's name, account number (wallet address), physical address, national identity number or DOB/place of birth, and customer identification number
2. Collect the beneficiary's name and account number (wallet address)
3. Transmit this information to the beneficiary VASP immediately and securely

**While FATF standards are not directly US law, FinCEN's rulemaking is expected to adopt FATF's $1,000 threshold for virtual assets. ForgePay should implement to the $1,000 threshold now to be ahead of the expected rule.**

---

## Information Collection Requirements for Crypto Transfers

For ForgePay's virtual asset transactions at or above $1,000 (or $3,000 under current FinCEN rules), collect and retain:

### Originator (Sending Customer)
- [ ] Full legal name
- [ ] Cryptocurrency wallet address (origin)
- [ ] Account identifier (ForgePay account ID)
- [ ] Physical address OR national identity number OR DOB and place of birth
- [ ] Amount and asset type
- [ ] Date of transfer

### Beneficiary (Receiving Party)
- [ ] Name
- [ ] Cryptocurrency wallet address (destination)
- [ ] Account identifier at beneficiary VASP (if available)

### Transmission Requirement
This information must be transmitted to the **beneficiary VASP** (the service receiving the crypto) before or simultaneously with the transfer. This is the core challenge of crypto Travel Rule — the receiving party must be a VASP, and ForgePay must communicate with that VASP in a secure, standardized way.

---

## Crypto Travel Rule Solutions

The crypto industry has developed interoperability solutions that allow VASPs to share Travel Rule data peer-to-peer. ForgePay must select and implement one (or more) of these protocols:

### Option 1: TRUST (Travel Rule Universal Solution Technology)

- **What it is:** Industry consortium led by major US crypto exchanges (Coinbase, Kraken, etc.) for US-focused Travel Rule compliance
- **How it works:** Peer-to-peer data sharing between TRUST members; name matching for VASP discovery
- **Pros:** US-centric; major US exchanges are members; relatively simple integration
- **Cons:** Less global coverage; limited to member VASPs (counterparty must also be a member)
- **Integration:** REST API; see https://www.travelruleuniversalsolution.com
- **Cost:** Membership fee + implementation
- **ForgePay fit:** Good for US domestic transactions with major US VASPs

### Option 2: OpenVASP

- **What it is:** Open-source Travel Rule protocol; message exchange via Ethereum smart contracts and P2P messaging
- **How it works:** VASP identifiers are registered on-chain; encrypted peer-to-peer sessions for data exchange
- **Pros:** Decentralized; no single vendor dependency; open standard
- **Cons:** Adoption is limited; requires technical implementation effort
- **Integration:** Open-source SDKs available in Go, Python, JavaScript
- **Cost:** Open-source (implementation cost only)
- **ForgePay fit:** Good if ForgePay wants protocol independence; more engineering-heavy

### Option 3: Notabene

- **What it is:** Commercial Travel Rule compliance platform (SaaS)
- **How it works:** Cloud-based VASP directory and data sharing; integrates with FATF-compliant protocols (IVMS101 standard)
- **Pros:** Large network (1,000+ VASPs); multi-protocol support; regulatory reporting; KYB on counterparty VASPs
- **Cons:** SaaS cost; data shared with third-party vendor
- **Integration:** REST API; webhook callbacks; IVMS101 data model
- **Cost:** Subscription-based (pricing varies by volume)
- **ForgePay fit:** Best for fast time-to-market; global coverage; recommended for initial implementation

### Option 4: Sygna Bridge / CoolBitX

- Commercial platform popular in Asia-Pacific; also has US coverage
- IVMS101 compliant

### Option 5: VerifyVASP

- Commercial platform with FATF IVMS101 compliance
- Strong global coverage

### Recommendation for ForgePay

**Start with Notabene** for fastest compliance deployment:
1. Notabene's large network maximizes the percentage of transactions where ForgePay can exchange Travel Rule data
2. Its IVMS101-compliant data model is prepared for expected FinCEN rulemaking
3. The SaaS API integrates readily with ForgePay's Fastify-based unified-router and TypeScript crypto-gateway service
4. Notabene provides counterparty VASP screening (KYB) as part of the service

**Longer term:** Evaluate adding TRUST membership for US domestic transactions with major exchanges (Coinbase, Kraken, Gemini) for direct, low-latency data exchange.

---

## IVMS101 Data Standard

The **International Virtual Asset Message Standard (IVMS101)** is the industry-standard data schema for Travel Rule information exchange. Developed by the Joint Working Group on interVASP Messaging Standards.

All Travel Rule platforms (Notabene, Sygna, VerifyVASP) use IVMS101. ForgePay's crypto-gateway service should be designed to produce and consume IVMS101-formatted payloads.

**IVMS101 Key Fields:**

```json
{
  "originator": {
    "originatorPersons": [{
      "naturalPerson": {
        "name": [{"nameIdentifier": [{"primaryIdentifier": "Smith", "secondaryIdentifier": "John", "nameIdentifierType": "LEGL"}]}],
        "dateAndPlaceOfBirth": {"dateOfBirth": "1985-07-15", "placeOfBirth": "New York, US"},
        "nationalIdentification": {"nationalIdentifier": "123-45-6789", "nationalIdentifierType": "SSNK", "countryOfIssue": "US"}
      }
    }],
    "accountNumber": ["bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"]
  },
  "beneficiary": {
    "beneficiaryPersons": [{
      "naturalPerson": {
        "name": [{"nameIdentifier": [{"primaryIdentifier": "Jones", "secondaryIdentifier": "Alice", "nameIdentifierType": "LEGL"}]}]
      }
    }],
    "accountNumber": ["0x71C7656EC7ab88b098defB751B7401B5f6d8976F"]
  },
  "transferAmount": {
    "virtualAssetType": "ETH",
    "amount": "500000000000000000",
    "decimals": 18
  }
}
```

---

## Unhosted Wallets

When a customer sends to or receives from an **unhosted wallet** (a private wallet not associated with a VASP — e.g., a MetaMask wallet), there is no beneficiary VASP to transmit Travel Rule information to.

FinCEN's proposed rule and FATF guidance address this scenario:
- For transfers to unhosted wallets above the threshold, ForgePay must collect and **retain** the beneficiary information (even if it cannot be transmitted)
- Some implementations require obtaining a signed attestation from the customer confirming the unhosted wallet belongs to them
- Apply enhanced due diligence for large unhosted wallet transfers

**Current ForgePay approach (until final FinCEN rule):**
- Collect beneficiary name and wallet address for all unhosted wallet transfers above $3,000
- For transfers above $10,000 to unhosted wallets, require customer attestation of wallet ownership
- Flag unhosted wallet transfers in the AML engine for monitoring

---

## Implementation Roadmap

| Phase | Action | Timeline |
|-------|--------|----------|
| 1 | Sign up for Notabene (or chosen vendor) | Month 1 |
| 2 | Integrate Notabene API into crypto-gateway service | Month 1–2 |
| 3 | Configure IVMS101 data collection in KYC flows | Month 1–2 |
| 4 | Test Travel Rule data exchange with counterparty VASPs | Month 2–3 |
| 5 | Deploy to production | Month 3 |
| 6 | Join TRUST for US domestic coverage | Month 4–6 |
| 7 | Monitor FinCEN rulemaking; adjust thresholds if final rule lowers to $1,000/$250 | Ongoing |

---

## Recordkeeping

Travel Rule records must be retained for **5 years** from the date of the transmittal order. (31 CFR 1010.430)

For crypto transactions:
- The IVMS101 data package exchanged with the counterparty VASP
- The counterparty VASP's identity and certification status
- The blockchain transaction hash linking the on-chain transfer to the Travel Rule record
- Any attestations from customers regarding unhosted wallets

---

## Key Citations

| Reference | Description |
|-----------|-------------|
| 31 CFR 1010.410(e) | Travel Rule — information to be transmitted with funds transfers |
| 31 CFR 1010.410(f) | $3,000 threshold for funds transfer recordkeeping |
| 31 CFR 1022.410 | MSB-specific funds transfer recordkeeping |
| FinCEN FIN-2019-G001 | Travel Rule applicability to virtual currency |
| FATF Recommendation 15 | Global standard for virtual asset Travel Rule |
| FATF Updated Guidance (2021) | Implementation guidance for VASPs |

---

*Travel Rule regulations for virtual assets are evolving rapidly. Monitor FinCEN's rulemaking and FATF guidance updates. This document should be reviewed and updated at least semi-annually.*
