# FinCEN MSB Registration Guide
## Registration of Money Services Business (RMSB) — Form 107

**Regulation:** 31 U.S.C. § 5330; 31 CFR 1022.380
**Deadline:** Within 180 days of commencing operations as an MSB
**Filing Fee:** None (free)
**System:** FinCEN BSA E-Filing System — https://bsaefiling.fincen.treas.gov

---

## 1. Is ForgePay an MSB?

Under 31 CFR 1010.100(ff), a "money services business" includes any person (other than a bank) doing business in the US as:

- A **money transmitter** — accepting currency, funds, or the value of funds and transmitting it to a third party; or
- A **dealer in foreign exchange** — exchanging currency for customers

ForgePay qualifies as an MSB under multiple categories:

| ForgePay Activity | MSB Category | Citation |
|------------------|--------------|----------|
| Moving merchant settlement funds | Money transmitter | 31 CFR 1010.100(ff)(5) |
| Processing USDC/USDT payments | Money transmitter (convertible virtual currency) | FinCEN FIN-2019-G001 |
| Processing BTC/ETH/LTC/XMR | Money transmitter (convertible virtual currency) | FinCEN FIN-2013-G001; FIN-2019-G001 |
| x402 AI agent payment flows | Money transmitter | 31 CFR 1010.100(ff)(5) |

**Note:** Under FinCEN's 2019 guidance (FIN-2019-G001), a person who "accepts and transmits convertible virtual currency" is a money transmitter subject to BSA obligations regardless of whether the virtual currency has legal tender status.

---

## 2. What to Prepare Before Filing

Gather the following before logging into BSA E-Filing:

### Business Information
- [ ] Full legal name of the entity (as registered with state of incorporation)
- [ ] DBA names (if any)
- [ ] EIN (Employer Identification Number) from IRS
- [ ] State of incorporation and date of formation
- [ ] Physical business address (no P.O. boxes for principal place of business)
- [ ] Mailing address (if different)
- [ ] Phone number and email address
- [ ] Website URL: `forgepay.com`

### MSB Activity Information
- [ ] Date business commenced (or anticipated commencement date)
- [ ] Primary MSB category (check all that apply — see Section 3)
- [ ] List of all states where ForgePay operates or plans to operate
- [ ] Estimated monthly transaction volume (dollar amount)

### Agent Information (if applicable)
- [ ] List of authorized agents (businesses that conduct MSB activity on ForgePay's behalf)
- [ ] For each agent: legal name, address, EIN, and MSB category

### Controlling Person Information
- [ ] Name, title, and contact information for the Principal Compliance Officer (PCO)
- [ ] Names of all owners holding 25%+ of the business

---

## 3. MSB Categories to Check on Form 107

On the RMSB form, check all categories that apply to ForgePay's operations:

**Check the following boxes:**

| Box | Category | ForgePay Reason |
|-----|----------|-----------------|
| Money Transmitter | Transmitting currency or the value of funds | Core payment processing; merchant settlements |
| Dealer in Foreign Exchange | Exchanging currency | Stablecoin USDC/USDT conversion; crypto-to-fiat conversion |
| Provider of Prepaid Access | If issuing stored-value instruments | Evaluate if x402 wallet balances qualify |

**Do NOT check (if not applicable):**
- Check Casher
- Seller of Prepaid Access
- Currency Dealer/Exchanger (only if providing physical currency exchange)
- Issuer of Money Orders
- Issuer of Traveler's Checks

> **Legal counsel review required** before final categorization to ensure all ForgePay activities are correctly categorized and no categories are inadvertently omitted.

---

## 4. Step-by-Step BSA E-Filing Registration

### Step 1: Create BSA E-Filing Account

1. Navigate to [https://bsaefiling.fincen.treas.gov](https://bsaefiling.fincen.treas.gov)
2. Click **"Register"** on the top right
3. Select **"Create a BSA E-Filing Account"**
4. Complete the account registration:
   - Enter legal entity name
   - Enter EIN
   - Create a username and password
   - Provide security questions
5. Confirm your email address via the verification link
6. Log in with your new credentials

### Step 2: Access the RMSB Form

1. From the BSA E-Filing homepage, click **"File a BSA Report"**
2. Select **"FinCEN Registration of Money Services Business (RMSB)"**
3. You will be presented with Form 107

### Step 3: Complete Form 107

The form has the following sections:

**Part I — Type of Filing**
- Select: "Initial Registration" (for first-time registration)
- Enter the date ForgePay commenced MSB activities

**Part II — MSB Information**
- Legal name of MSB
- DBA name(s)
- EIN
- Physical address of principal place of business
- Mailing address
- Phone, fax, email, website

**Part III — Type of MSB**
- Check all applicable boxes (see Section 3 above)
- For each checked category, enter estimated annual transaction volume

**Part IV — Agent Information**
- If ForgePay uses authorized agents to conduct MSB activity, list them here
- For sub-processors and payment partners that act as agents, consult legal counsel on whether they must be listed

**Part V — Controlling Persons**
- List all individuals with control over ForgePay's compliance functions
- Include the designated BSA/AML Compliance Officer

**Part VI — Signature**
- An authorized signatory (typically CEO or CCO) must electronically sign
- By signing, the individual certifies the information is true and accurate

### Step 4: Submit and Retain Confirmation

1. Review all entries for accuracy
2. Click **"Submit"**
3. Download and save the **BSA E-Filing confirmation number** — this is your proof of registration
4. FinCEN will assign an MSB Registration Number — retain this for state license applications

---

## 5. Re-Registration Requirements

### Every Two Years (31 CFR 1022.380(b)(2))

ForgePay must re-register with FinCEN **every two years** by **December 31** of the year in which the two-year period expires.

- Initial registration: within 180 days of commencing operations
- Re-registration: by December 31 every two years thereafter (e.g., if initial registration is in 2026, re-register by December 31, 2028)
- Re-registration uses the same Form 107, selecting "Re-Registration" in Part I

### Amendments Within 180 Days

ForgePay must amend its registration within **180 days** if there is a **change in ownership or control** that causes a change in the information previously submitted. (31 CFR 1022.380(b)(3))

---

## 6. After Registration

Once registered, FinCEN will:
- Assign a **FinCEN MSB ID number**
- Make ForgePay searchable in the public MSB registrant search at [https://www.fincen.gov/msb-registrant-search](https://www.fincen.gov/msb-registrant-search)

**Immediately after registration, ForgePay must:**
1. Ensure the written BSA/AML program is finalized (see `02_bsa_aml_program.md`)
2. Begin state MTL applications where required (see `03_state_mtl_priority_matrix.md`)
3. Implement SAR and CTR filing procedures (see `07_sar_ctr_procedures.md`)
4. Activate OFAC screening for all transactions (see `06_ofac_compliance_program.md`)

---

## 7. MSB Registration vs. State MTL — Key Distinction

| Aspect | FinCEN MSB Registration | State MTL |
|--------|------------------------|-----------|
| Scope | Federal (nationwide) | State-by-state |
| Cost | Free | $500–$15,000+ per state |
| Required before operating | Within 180 days | Before operating in that state |
| Ongoing obligation | Re-register every 2 years | Annual renewal |
| Enforced by | FinCEN (Treasury) | State financial regulator |

FinCEN registration does **not** substitute for state MTLs. ForgePay must obtain MTLs in each state before offering money transmission services to customers in that state (with limited exceptions for states that have de minimis exemptions or specific carve-outs).

---

## 8. Penalties for Non-Compliance

Failure to register as an MSB is a criminal offense under 31 U.S.C. § 5330(e):
- Up to **5 years imprisonment**
- Civil monetary penalties up to **$10,000 per violation** (31 CFR 1010.820)
- FinCEN has authority to impose additional civil penalties under 31 U.S.C. § 5321

---

## 9. Record Retention

Retain a copy of:
- The completed Form 107 (RMSB)
- The BSA E-Filing submission confirmation
- The assigned FinCEN MSB registration number
- All subsequent amendments and re-registrations

Retention period: **5 years** from the date of the filing (31 CFR 1010.430)

---

*Consult legal counsel before submitting. This guide is for internal planning purposes only.*
