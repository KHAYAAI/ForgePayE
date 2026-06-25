# ForgePay OFAC Compliance Program
## Office of Foreign Assets Control — Sanctions Screening Program

**Authority:** International Emergency Economic Powers Act (IEEPA), 50 U.S.C. §§ 1701–1706; Trading with the Enemy Act (TWEA), 50 U.S.C. § 4301 et seq.; 31 CFR Parts 500–599 (OFAC program-specific regulations)
**Program Owner:** Chief Compliance Officer
**Last Updated:** June 2026

---

## Purpose

This document describes ForgePay's program to comply with sanctions administered by the U.S. Treasury Department's Office of Foreign Assets Control (OFAC). OFAC administers and enforces economic and trade sanctions against targeted foreign countries, regimes, terrorists, narcotics traffickers, weapons of mass destruction proliferators, and other threats to US national security and foreign policy.

**OFAC compliance is not optional.** Violations can result in civil penalties of up to $1,000,000+ per transaction and criminal penalties including imprisonment. Unlike BSA violations, OFAC violations are a strict liability matter — a good-faith violation is still a violation, though it factors into penalty determination.

---

## Sanctions Lists

ForgePay screens against the following OFAC-administered lists:

### Primary Lists

| List | Description | Screening Required |
|------|-------------|-------------------|
| SDN List (Specially Designated Nationals) | Individuals and entities whose assets are blocked; US persons generally prohibited from dealing with | YES — required for all customers and transactions |
| Consolidated Sanctions List | Combined list including SDN, SSI (Sectoral Sanctions Identifications), and other OFAC lists | YES — screen all customers |
| OFAC Sanctions Programs | Country-based and list-based programs (Iran, North Korea, Cuba, Syria, Russia/Ukraine-specific programs) | YES — screen country of residence/operations |

### Secondary Lists (Supplemental Screening)

| List | Source | Notes |
|------|--------|-------|
| EU Consolidated Sanctions | European Union | For EU transactions; advisory screen |
| UN Security Council Consolidated List | United Nations | For global compliance coverage |
| FinCEN 314(a) List | FinCEN | Proactive search requests from law enforcement |

---

## Screening Architecture: ForgePay's Compliance-Monitor Service

ForgePay's **compliance-monitor** service (deployed as a microservice on AWS EKS, us-east-1) performs all OFAC screening. Key capabilities:

### Real-Time Transaction Screening

Every transaction processed by ForgePay is screened against OFAC lists **before** funds are moved. The screening flow:

```
Transaction Initiated
       ↓
compliance-monitor receives transaction event
       ↓
Extract screening fields (name, address, country, crypto wallet)
       ↓
Screen against SDN + Consolidated Sanctions List
       ↓
[No Match] → Transaction proceeds to payment router
[Potential Match] → Fuzzy match scoring algorithm
       ↓
[Score < Threshold] → Clear, proceed
[Score ≥ Threshold] → BLOCK + Alert queued for manual review
```

### Screening Fields

For each transaction, compliance-monitor screens:

| Field | Data Source | OFAC Lookup Type |
|-------|-------------|-----------------|
| Customer name | KYC records | Name match (SDN) |
| Customer country | KYC records | Country program match |
| Counterparty name | Transaction data | Name match (SDN) |
| Counterparty country | Transaction data | Country program match |
| Sending bank/wallet | Payment data | Entity match (SDN) |
| Receiving bank/wallet | Payment data | Entity match (SDN) |
| Crypto wallet address | Blockchain data | Wallet address match (OFAC's virtual currency addresses list) |
| IP address geolocation | Request metadata | Country-level sanctions screen |

### Name Matching Algorithm

OFAC names on the SDN list may appear in various forms (transliterations, aliases, partial names). ForgePay's screening uses:
- Exact name match
- Fuzzy match (Levenshtein distance, phonetic matching)
- Alias matching (all SDN aliases are included in the screen)
- Match score threshold: 85% similarity triggers a potential match alert

**Threshold tuning is critical:** Too high = missed hits; too low = excessive false positives drowning the compliance team. Review quarterly with the CCO.

### OFAC Virtual Currency Address Screening

OFAC publishes virtual currency addresses associated with SDN entries at [https://home.treasury.gov/policy-issues/financial-sanctions/recent-actions/20181101](https://home.treasury.gov/policy-issues/financial-sanctions/recent-actions/20181101). As of 2026, OFAC has designated numerous BTC, ETH, USDT, and other crypto addresses.

compliance-monitor screens all incoming and outgoing crypto wallet addresses against:
- OFAC's published virtual currency address list (updated in real-time via OFAC's SDN XML feed)
- Blockchain analytics risk scores (Chainalysis/TRM Labs integration) for indirect exposure

---

## Screening Frequency

| Trigger | Screening Action |
|---------|-----------------|
| New merchant onboarding | Full OFAC screen of business entity, all beneficial owners, all control persons |
| New consumer account creation | Full OFAC screen of individual |
| Each transaction | Real-time screen of all parties (see above) |
| Existing customer periodic refresh | Monthly re-screen of all active merchant accounts |
| OFAC list update | Within 24 hours of any OFAC SDN update, re-screen high-risk customers |
| Customer name/address change | Immediate re-screen upon change |
| FinCEN 314(a) request | Within 14 days of request receipt |

---

## Blocked Entity Procedures

When a customer or transaction matches or likely matches the SDN list:

### Step 1: Immediate Block

The compliance-monitor service automatically:
- Blocks the transaction from proceeding
- Freezes the customer account (no further transactions)
- Creates a compliance alert in the case management system
- Notifies the CCO and compliance team via alert (email + compliance dashboard)

No ForgePay employee may override a block without CCO approval. No one may "tip off" the customer that their account has been flagged.

### Step 2: Triage Within 1 Business Day

The compliance team reviews the alert:

**Is this a true match?**
- Compare all identifying information (name, DOB, address, aliases, ID numbers) against SDN entry
- Check all available identifiers

**True Match → Proceed to OFAC Reporting (Step 4)**

**Potential False Positive → Proceed to False Positive Process (Step 3)**

### Step 3: False Positive Process

For potential false positives (customer has a similar name to an SDN entry but may not be the same person/entity):

1. Gather all available identifying information from the customer:
   - Government-issued photo ID
   - Date of birth
   - Address
   - Other identifiers (SSN, passport number, etc.)
2. Compare against all identifiers listed in the SDN entry
3. If **not** the same person/entity (distinguishable): Document the analysis, clear the block, resume account/transaction. Retain the documentation for 5 years.
4. If **unclear**: Consult legal counsel. Consider submitting an OFAC license application if a legitimate business purpose exists.
5. If **confirmed same**: True match — proceed to OFAC reporting.

**OFAC Frequently Asked Questions (FAQ) on false positives:** https://ofac.treasury.gov/faqs

### Step 4: Reporting Blocked Transactions to OFAC

All blocked transactions (confirmed SDN matches) must be reported to OFAC within **10 business days** of the blocking action. (31 CFR 501.604)

**How to report:**
1. Navigate to OFAC's online reporting system: https://efts.treasury.gov/EFTS/#/home
2. Select "Blocked Property Report" (for frozen accounts) or "Rejected Transaction Report" (for transactions rejected without blocking assets)
3. Complete the report form with:
   - Reporter information (ForgePay entity name, address, CCO contact)
   - Date of blocking
   - Amount and type of property blocked
   - Identity of the blocked party (name, address, all known identifiers)
   - Reason for blocking (applicable SDN designation or sanctions program)
4. Submit and retain the confirmation number

**Annual Blocked Property Report:**
In addition to the initial report, ForgePay must file an **annual report** by September 30 each year (for the preceding year ending June 30) on all blocked property being held. (31 CFR 501.603)

---

## The 50% Rule

Under OFAC's **50% rule**, any entity owned **50% or more** (directly or indirectly) by one or more SDN-listed persons is itself treated as if it were on the SDN list — **even if that entity does not appear on the SDN list by name**.

ForgePay's KYC procedures must identify ultimate beneficial ownership to at least the 50% level to detect indirect SDN exposure.

**Example:** If a merchant applies to use ForgePay, and 55% of that merchant is owned by a company that is 80% owned by an SDN-listed individual, that merchant is effectively SDN-blocked even though neither the merchant nor its direct parent appears on the SDN list.

**Screening implication:** ForgePay must screen up the ownership chain for all business customers. The compliance-monitor service should:
- Screen all beneficial owners at 25% threshold (per CDD Rule)
- Apply SDN reasoning at 50% threshold
- For complex ownership structures, require legal opinion on ownership chain

---

## Jurisdictions Under Comprehensive Sanctions

ForgePay must block all transactions involving persons or entities in these comprehensively sanctioned countries:

| Country/Region | Sanctions Program | Notes |
|----------------|------------------|-------|
| Cuba | 31 CFR Part 515 (CACR) | Comprehensive; limited general licenses |
| Iran | 31 CFR Part 560 (ITSR) | Comprehensive; very limited exceptions |
| North Korea | 31 CFR Part 510 (NKSR) | Comprehensive |
| Syria | 31 CFR Part 542 | Comprehensive |
| Crimea region (Ukraine) | EO 13685 | Region-based, not country-wide |
| Donetsk People's Republic (DNR) | EO 14024 | Since 2022 |
| Luhansk People's Republic (LNR) | EO 14024 | Since 2022 |
| Russia (sector-specific) | EO 14024, CAATSA | Not comprehensive; specific sectors and individuals |

**IP-Based Blocking:** ForgePay's platform should implement IP-based geolocation blocking for comprehensively sanctioned countries. This is a first-line defense; it does not replace KYC-based screening.

---

## Recordkeeping

All OFAC screening records must be retained for **5 years** from the date of the screening action (31 CFR 501.601; 31 CFR 1010.430).

Retain:
- All OFAC screens conducted (customer ID, date, result, list version used)
- All potential match alerts and their dispositions
- All false positive analyses and supporting documentation
- All blocked transaction reports filed with OFAC
- All rejected transaction reports
- Annual blocked property reports
- OFAC license applications and approvals (if any)
- Communications with OFAC

---

## OFAC License Applications

In limited circumstances, OFAC may issue a license authorizing a transaction that would otherwise be prohibited. ForgePay may apply for an OFAC license if:

- A transaction has a legitimate humanitarian, diplomatic, or commercial purpose
- The transaction is for legal services to an SDN-designated person (generally licensed)
- OFAC general licenses (pre-approved by regulation) cover the activity

**To apply for a specific OFAC license:**
1. Navigate to https://ofac.treasury.gov/license-applications
2. Complete the license application with full details of the proposed transaction
3. Submit and await response (can take months)
4. Do not proceed with the transaction until the license is granted

---

## Penalties Awareness

OFAC violations carry severe civil and criminal penalties:

| Violation Type | Maximum Civil Penalty |
|---------------|----------------------|
| Per transaction violation | Greater of $370,000 or twice the transaction amount |
| Willful or egregious violation | Up to $1,146,849 per violation (indexed for inflation) |
| Criminal penalty | Up to 20 years imprisonment; up to $1,000,000 fine |

OFAC evaluates violations on a base penalty matrix, adjusted for:
- Willfulness (knowing vs. unknowing)
- Recklessness
- History of sanctions violations
- Whether OFAC discovered the violation or the company self-disclosed
- Cooperation with OFAC investigation
- Existence of a compliance program

**Voluntary self-disclosure** can reduce penalties by up to 50%. If ForgePay discovers an OFAC violation, consult legal counsel immediately on whether to self-disclose.

---

## Program Testing and Audit

### Semi-Annual Screening Effectiveness Test

The CCO and engineering team conduct a semi-annual test of the OFAC screening system:
- Use synthetic test records with known SDN names, aliases, and wallet addresses
- Confirm the screening system identifies all true positives
- Confirm the false positive rate is within acceptable parameters
- Test failure notification procedures (what happens if compliance-monitor is down?)

### Annual OFAC Audit (Part of AML Audit)

The annual independent AML audit includes OFAC compliance testing:
- Review of screening system configuration
- Sample testing of screening logs
- Review of false positive dispositions
- Review of blocked transaction reports
- Comparison of ForgePay's screening list versions against current OFAC lists

### OFAC List Update Monitoring

- OFAC SDN list updates may occur without advance notice (emergency designations)
- ForgePay's compliance-monitor service must subscribe to OFAC's real-time SDN XML feed
- OFAC list changes are also distributed via the OFAC Notification Service (email): subscribe at https://ofac.treasury.gov/subscribe-for-updates
- **Weekly manual review** of OFAC update emails by compliance team (in addition to automated feed)

---

## Key OFAC Resources

| Resource | URL |
|----------|-----|
| OFAC SDN List | https://ofac.treasury.gov/sanctions-list-service |
| OFAC SDN XML Feed (real-time) | https://www.treasury.gov/ofac/downloads/sdn.xml |
| OFAC Notification Service | https://ofac.treasury.gov/subscribe-for-updates |
| OFAC FAQs | https://ofac.treasury.gov/faqs |
| Report Blocked Transactions | https://efts.treasury.gov/EFTS/#/home |
| OFAC License Applications | https://ofac.treasury.gov/license-applications |
| OFAC Compliance Hotline | 1-800-540-6322 |
| Virtual Currency OFAC Guidance | https://ofac.treasury.gov/media/15971/download?inline |

---

*This OFAC compliance program is reviewed and updated annually and after any material changes to ForgePay's business, products, or applicable OFAC sanctions programs. Questions regarding OFAC compliance should be directed to the CCO.*
