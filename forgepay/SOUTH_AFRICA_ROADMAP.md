# ForgePay South Africa: Month-by-Month Launch Roadmap

## Executive Summary

**Total Timeline:** 12 months to fully operational with 200+ merchants  
**Total Investment:** R 13-16 million (Year 1)  
**Target GMV:** R 100-200 million cumulative by end of Year 1  
**Key Milestone:** FSCA license approved by Month 4

---

## Phase 1: Foundation (Months 1-3)

### Month 1: Company Setup & Regulatory Foundation

**Theme:** "Get Legal"

#### Week 1-2: Corporate Registration

- [ ] Register ForgePay SA (Pty) Ltd with CIPC
  - Director: [Your name + co-founder/shareholders]
  - Registered address: [Office address in Cape Town or Johannesburg]
  - Memorandum of Incorporation (MOI): Standard company articles
  - **Cost:** R 500 (CIPC filing)
  - **Timeline:** 1 week

- [ ] Get Tax Registration Number (TRN) from SARS
  - Apply online: www.sars.gov.za (e-Services portal)
  - Documents: CIPC certificate, ID, business plan
  - **Cost:** Free
  - **Timeline:** 1 week

- [ ] Secure business address
  - Cape Town option: Wesbuild offices (De Waterkant, V&A Waterfront area) — R 8,000/month shared space
  - Johannesburg option: Parktown or Sandton coworking — R 8,000-10,000/month
  - Include: Meeting rooms, phone line, fiber internet, parking

#### Week 2-3: Hiring & Onboarding

- [ ] Hire Compliance Officer (external contractor initially, 20 hrs/week)
  - **Option 1:** Big 4 firm (Deloitte, EY, KPMG, PwC) — R 5,000-10,000/month part-time
  - **Option 2:** Freelance compliance consultant — R 3,000-7,000/month
  - **Task:** Lead FSCA application preparation
  - **Timeline:** 2-3 weeks to onboard

- [ ] Hire Business Development Manager
  - **Role:** Bank relationships, merchant outreach, partnerships
  - **Timeline:** 4-6 weeks (can start interviews week 2, onboard week 4-6)

- [ ] Recruit CTO / Lead Engineer (start process, may take 8-12 weeks)
  - **Role:** Architecture, team lead, technical strategy
  - **Timeline:** Announce role, start interviews; target onboarding Month 2

#### Week 3-4: Compliance & Regulatory Setup

- [ ] Appoint Data Protection Officer (DPO) — POPIA compliance
  - **Option 1:** External DPO firm — R 3,000-5,000/month
  - **Option 2:** Have Compliance Officer also be DPO (combined role)
  - **Task:** Register with POPIA Commissioner (free, online form)
  - **Timeline:** 30 days to register

- [ ] Register with FIC (Financial Intelligence Centre) — Free
  - **Process:** Online portal → Register business type (PSP) → Confirm AML/CFT officer
  - **Timeline:** 1 day to register
  - **Cost:** Free

- [ ] Start FSCA Money Transmitter License application (MIL001)
  - **Process:** Download form from FSCA.org.za → Fill out (20-30 page form)
  - **Documents to prepare:**
    - Business plan (3-5 year financial projections)
    - Proof of capital (R 500,000 in company bank account)
    - Organizational chart (you, CTO, Compliance Officer, etc.)
    - Director/shareholder identification documents
    - AML/CFT Compliance Program (50+ page detailed policy)
    - Customer Due Diligence procedures
    - Record retention policy
    - Disaster recovery plan
    - Insurance certificate (apply for professional indemnity, R 5M+ cover)
  - **Timeline:** 4-6 weeks to prepare; submit end of Month 1
  - **Cost:** R 30,000 (compliance consulting to prepare, external audit not yet)

- [ ] Open company bank account
  - **Bank:** Nedbank or FNB (recommended for business accounts)
  - **Deposit:** R 500,000 initial (for proof of capital)
  - **Documents needed:** CIPC certificate, ID, TRN, business plan
  - **Timeline:** 1-2 weeks
  - **Cost:** Free (no setup fee, but monthly fees apply)

- [ ] Purchase Insurance
  - **Professional Indemnity:** R 5M cover (FSCA requirement)
    - **Cost:** R 15,000-30,000/year (pay first 3 months upfront for FSCA)
    - **Insurer:** Check FSCA-approved list (Zurich, Santam, Old Mutual)
  - **Cyber Insurance:** R 10M cover (highly recommended)
    - **Cost:** R 10,000-20,000/year
  - **Timeline:** 1-2 weeks
  - **Total:** R 25,000-50,000 upfront for 3 months

#### Week 4: AWS & Infrastructure Foundation

- [ ] AWS account setup (af-south-1)
  - **Create:** Root account, security credentials stored in Vault
  - **Enable:** MFA, CloudTrail, GuardDuty, Security Hub
  - **Cost:** Free (pay-as-you-go, R 5,000-10,000/month once live)

- [ ] Terraform initialization (infrastructure-as-code foundation)
  - **Create:** Git repo for infrastructure code
  - **Setup:** S3 backend for Terraform state (encrypted, versioned)
  - **Template:** Use existing forgepay/infra/terraform files
  - **Cost:** Free (git + S3, already budgeted in AWS)

#### **Month 1 Cost Summary**

| Item | Cost |
|------|------|
| CIPC + legal setup | R 5,000 |
| Office space (1 month) | R 8,000 |
| Compliance officer (part-time, 1 month) | R 5,000 |
| FSCA prep (audit/consulting) | R 30,000 |
| Bank account + proof of capital | R 500,000 (deposited, not spent) |
| Insurance (3 months upfront) | R 30,000 |
| AWS + Terraform | R 5,000 |
| Contingency (10%) | R 20,000 |
| **TOTAL** | **R 603,000** |

---

### Month 2: Merchant Onboarding Setup & Bank Integration

**Theme:** "Build & Integrate"

#### Engineering Kickoff (Weeks 1-2)

- [ ] Hire Backend Engineer #1 (payment processing)
  - **Onboard:** Start first week of Month 2
  - **First task:** Database schema design (merchants, transactions, settlements)

- [ ] Hire DevOps Engineer (infrastructure)
  - **Onboard:** Start first week of Month 2
  - **First task:** EKS cluster setup (af-south-1, 3 AZs, t3.large starter nodes)

- [ ] GitHub repo setup
  - **Create:** forgepay/south-africa branch (or separate repo)
  - **CI/CD:** GitHub Actions pipeline (build, test, deploy)
  - **Access:** All team members with SSH keys

#### Bank Integration (Weeks 2-4)

- [ ] Plaid SDK integration (for consumer bank account verification)
  - **Purpose:** Allow merchants to verify they own bank accounts
  - **Setup:** Plaid sandbox (dev), then move to production
  - **Cost:** Plaid ZA starter plan = R 500/month + per-link fees

- [ ] Nedbank OpenAPI integration (bank transfers in ZA)
  - **Purpose:** Route payments to merchants' Nedbank accounts
  - **Process:** Apply for Nedbank developer account (2-3 weeks)
  - **Meetings:** Arrange demo with Nedbank treasury team (Johannesburg)
  - **Documentation:** Request OpenAPI spec from Nedbank
  - **Cost:** Free (relationship-based, no per-transaction fees yet)

- [ ] FNB API exploration (backup bank, alternative to Nedbank)
  - **Purpose:** Multi-bank support for resilience
  - **Contact:** FNB Business Banking development team
  - **Documentation:** Request API docs
  - **Timeline:** Month 3 (lower priority than Nedbank)

#### Compliance Setup (Weeks 2-4)

- [ ] AML/CFT procedures documentation (detailed)
  - **Sections:**
    - Customer Due Diligence (CDD) — KYC procedures
    - Know Your Customer (KYC) — Merchant onboarding forms
    - Suspicious Activity Reporting (SAR) — Manual review process
    - Record retention — 5-year data retention policy
    - Staff training — Quarterly AML/CFT refresher training
  - **Output:** 50+ page compliance manual
  - **Review:** Internal legal review + external audit
  - **Cost:** R 10,000-15,000 (external legal review)

- [ ] Merchant onboarding flow (designed)
  - **Screens:**
    1. Business info (name, registration, tax ID)
    2. Director/owner info (ID verification, proof of address)
    3. Bank account (for settlement)
    4. AML/CFT attestation (merchant confirms legality)
    5. Manual review by compliance team (2-3 business days)
    6. Approval or rejection
  - **Timeline:** Design in Week 3, build in Month 3

- [ ] FSCA follow-up
  - **Status:** Clarification requests from FSCA expected mid-Month 2
  - **Response:** Respond within 5 business days with additional docs
  - **Timeline:** Ongoing through Month 3

#### **Month 2 Cost Summary**

| Item | Cost |
|------|------|
| Backend engineer (1 month) | R 105,000 |
| DevOps engineer (1 month) | R 115,000 |
| Office space | R 8,000 |
| Compliance officer (1 month, part-time) | R 5,000 |
| AWS (EKS cluster, DB, storage) | R 30,000 |
| Plaid integration | R 500 |
| Bank integration consulting | R 10,000 |
| Legal + compliance review | R 15,000 |
| Insurance (1 month) | R 10,000 |
| Contingency | R 30,000 |
| **TOTAL** | **R 328,500** |

---

### Month 3: Staging Environment & Pilot Testing

**Theme:** "Test & Validate"

#### Engineering (Weeks 1-4)

- [ ] Router service deployment (Hyperswitch payment router)
  - **Status:** Deploy to EKS in staging (af-south-1)
  - **Features:** Basic payment processing, card tokenization via Hyperswitch vault
  - **Testing:** Unit tests, integration tests with mock bank APIs
  - **Goal:** 90%+ test coverage

- [ ] Database setup and optimization
  - **Schema:** Merchants, transactions, settlements, compliance logs
  - **Backup:** Automated daily snapshots to S3
  - **Monitoring:** CloudWatch metrics for query performance
  - **Goal:** <100ms p99 latency for merchant queries

- [ ] Webhook normalizer (unified-router)
  - **Purpose:** Normalize bank API webhooks (different formats per bank)
  - **Tests:** Mock webhooks from Nedbank, FNB, Plaid
  - **Features:** Deduplication, retry logic, error handling
  - **Goal:** 99.95% webhook delivery rate

- [ ] Load testing
  - **Tool:** k6 (Grafana load testing tool)
  - **Scenario:** 1,000 transactions/hour, peak 5,000/hour
  - **Target:** <2 second p99 latency at peak load
  - **Results:** Generate load test report for ops team

#### Merchant Onboarding (Weeks 2-4)

- [ ] Onboarding flow MVP
  - **Frontend:** Simple Next.js form (email, business name, bank account)
  - **Backend:** KYC verification, compliance review workflow
  - **Database:** Merchants table with status (pending, approved, rejected)
  - **Tests:** E2E tests for happy path (approve merchant in 2 hours)

- [ ] Compliance automation
  - **Compliance-monitor service:** Basic AML/CFT rules
  - **Rules:** Flag transactions >R 50k, rapid cycling, new merchants with large txns
  - **Dashboard:** Compliance team view of flagged transactions (manual review)
  - **SAR export:** Export data for FIC submission (manual filing, not yet automated)

- [ ] Pilot merchant recruitment
  - **Recruit:** 3 test merchants (small e-commerce, SaaS, crypto exchange)
  - **Onboarding:** Put through onboarding flow, get manual approval
  - **Test accounts:** Each merchant gets test card, test bank account, test crypto wallet

#### FSCA Preparation (Weeks 1-4)

- [ ] Submit additional FSCA documentation
  - **IT Security:** Third-party security audit (penetration test)
    - **Cost:** R 30,000-50,000
    - **Duration:** 2 weeks (test week, report week)
  - **Disaster Recovery:** Simulate RDS failure → failover to eu-west-1
    - **Test:** Full backup → restore to test RDS
    - **Document:** Failover procedures, RTO/RPO targets
  - **Audit Trail:** Generate sample audit logs (all data access, changes, user actions)

- [ ] FSCA communication
  - **Schedule:** Weekly check-in calls with FSCA (assigned case officer)
  - **Prepare:** Weekly status updates, clarification documents
  - **Goal:** No surprises; flag any red flags early

#### **Month 3 Cost Summary**

| Item | Cost |
|------|------|
| Engineer salaries (2 × R 110k) | R 220,000 |
| Office space | R 8,000 |
| Compliance officer (1 month) | R 5,000 |
| AWS (staging env, larger cluster) | R 50,000 |
| Plaid (sandbox + small prod usage) | R 1,000 |
| Security audit (penetration test) | R 40,000 |
| Load testing tools (k6) | R 5,000 |
| Business dev (recruiting pilot merchants) | R 3,000 |
| Insurance (1 month) | R 10,000 |
| Contingency | R 30,000 |
| **TOTAL** | **R 372,000** |

---

## Phase 2: MVP Launch (Month 4)

**Theme:** "Go Live"

### Week 1: FSCA Approval (Expected)

- [ ] FSCA Money Transmitter License: **APPROVED**
  - **Process:** Final FSCA decision committee meets (typically month 4-6)
  - **Notification:** FSCA issues formal license certificate
  - **Next steps:** Upload certificate to website, notify merchants

- [ ] License framing & announcement
  - **Create:** Press release ("ForgePay Launches as FSCA-Regulated Payment Processor")
  - **Notify:** Pilot merchants, press, banking community
  - **Website:** Update homepage with FSCA license logo

### Week 1-2: Production Deployment

- [ ] Production EKS cluster (af-south-1)
  - **Nodes:** 3 × c6i.2xl + 2 × t3.large (mixed instance types)
  - **Security:** Security groups, network policies, RBAC (role-based access control)
  - **Monitoring:** CloudWatch, Prometheus, Grafana, AlertManager

- [ ] Production database
  - **RDS Aurora PostgreSQL:** 2-8 ACUs serverless (auto-scale)
  - **Backup:** Daily snapshots, 30-day retention
  - **Monitoring:** Performance Insights, slow query log

- [ ] Production routing
  - [ ] Route 53 DNS
  - [ ] CloudFront CDN (cache dashboard, static assets)
  - [ ] WAF rules (block common attacks, rate limiting)
  - [ ] ALB (application load balancer)

- [ ] Secrets management
  - [ ] AWS Secrets Manager (store API keys, database credentials)
  - [ ] KMS encryption (regional key for af-south-1)
  - [ ] Audit logging (track all secret access)

### Week 2-3: Soft Launch

- [ ] Merchant onboarding (first 5-10 merchants)
  - **Profile:** Mix of sizes (small e-commerce, SaaS, crypto exchange)
  - **Process:** Direct outreach, personalized onboarding
  - **Support:** Direct WhatsApp/email support (founder-level service)

- [ ] Payment processing
  - [ ] Card payments (via Hyperswitch + bank acquiring)
  - [ ] EFT transfers (Nedbank API live, FNB backup)
  - [ ] Crypto/stablecoins (Polygon ZA node, USDC/USDT)
  - **Daily monitoring:** Manual checks of settlement reports

- [ ] Compliance monitoring
  - [ ] Daily suspicious activity review (compliance officer)
  - [ ] Manual SAR filing if needed (first SAR expected: unlikely for small pilot)

### Week 3-4: Scale Testing

- [ ] Target: R 500,000 GMV in first month
  - **Assumption:** 10 merchants, R 50k average transaction
  - **Monitoring:** Email alerts if any merchant gets blocked/suspicious

- [ ] Merchant support
  - [ ] Help merchant integrate checkout (via API docs or dashboard)
  - [ ] Support payment failures (help debug card declines, bank rejections)

### **Month 4 Cost Summary**

| Item | Cost |
|------|------|
| Engineer salaries (2 × R 112.5k, 1.5 months) | R 337,500 |
| Office space (1 month) | R 8,000 |
| Compliance officer (1.5 months, part-time) | R 7,500 |
| AWS (production cluster, larger) | R 70,000 |
| Bank integration ops (live) | R 5,000 |
| Insurance (1 month) | R 10,000 |
| **TOTAL** | **R 438,000** |

---

## Phase 3: Scale (Months 5-6)

**Theme:** "Grow Merchants, Scale Operations"

### Month 5

#### Hiring

- [ ] Backend Engineer #2 (Python, MoR layer — tax, checkout, yield)
  - **Onboard:** Week 2-3 of Month 5
  - **First task:** Build tax calculation engine

- [ ] Blockchain Engineer (TypeScript, Solidity)
  - **Onboard:** Week 3-4 of Month 5
  - **First task:** Stablecoin payment settlement automation

#### Features

- [ ] Tax calculation & reporting
  - **Feature:** Automatic monthly tax reports for merchants (by payment method, geography)
  - **Compliance:** Track USDC prices for capital gains tax

- [ ] Merchant dashboard
  - **Sections:** Transaction history, settlement records, tax reports, compliance status
  - **API:** Expose via REST API for merchant apps

- [ ] POPIA compliance audit
  - **External firm:** Conduct full audit (data handling, retention, deletion)
  - **Cost:** R 40,000-80,000
  - **Output:** POPIA audit report for compliance files

#### Merchant Growth

- [ ] Target: 50 merchants by end of Month 5
  - **Outreach:** Business development manager activates network
  - **Onboarding time:** Reduced from 3 days to same-day via automated KYC
  - **GMV:** Target R 5-10M/month

### Month 6

#### Hiring

- [ ] Frontend Engineer (React/Next.js dashboard)
  - **Onboard:** Week 1-2
  - **First task:** Improve dashboard UX

- [ ] QA / Test Automation Engineer
  - **Onboard:** Week 2-3
  - **First task:** Build regression test suite

- [ ] Customer Success Manager
  - **Onboard:** Week 1
  - **First task:** Develop onboarding playbook (standardize 3-day process)

- [ ] Financial Controller (for accounting/tax)
  - **Onboard:** Week 2
  - **First task:** Set up monthly P&L process

- [ ] DevOps / SRE #2 (second on-call engineer)
  - **Onboard:** Week 3-4
  - **First task:** Implement Karpenter for node autoscaling

#### Features

- [ ] Agent credit lines (optional for merchants)
  - **Purpose:** Quick R 100-500k cash advances for merchants
  - **Terms:** 2-3% fee, settled from next month's sales
  - **Compliance:** AML/CFT review required for each credit request

- [ ] Stablecoin settlement (USDC/USDT)
  - **Feature:** Merchants can choose settlement in USDC instead of ZAR
  - **Prices:** Updated hourly (USDC/ZAR from Coinbase API)

- [ ] Automated SAR filing
  - **Process:** Compliance-monitor → SAR template → FIC upload (auto-generated, manual review)
  - **Expected volume:** 1-2 SARs/month (if at R 10M GMV)

#### Merchant Growth & Partner Ecosystem

- [ ] Partner integrations
  - [ ] WooCommerce plugin (for merchants to integrate checkout)
  - [ ] Shopify app (ForgePay payment method in Shopify)
  - [ ] Invoice.to integration (invoice → automated payment collection)

- [ ] Merchant success stories
  - [ ] Case studies: 3 merchants (how they use ForgePay, GMV impact)
  - [ ] Website: Publish case studies + testimonials

#### Month 5-6 Cost Summary

| Item | Month 5 | Month 6 | Total |
|------|---------|---------|-------|
| Engineer salaries (4 engineers, full month) | R 450,000 | R 450,000 | R 900,000 |
| Non-tech hires (CSM, Finance, QA) | R 100,000 | R 140,000 | R 240,000 |
| Office space | R 8,000 | R 8,000 | R 16,000 |
| AWS (scaling cluster) | R 100,000 | R 120,000 | R 220,000 |
| POPIA audit | R 50,000 | - | R 50,000 |
| Integrations (WooCommerce, Shopify) | R 20,000 | R 10,000 | R 30,000 |
| Insurance | R 10,000 | R 10,000 | R 20,000 |
| **TOTAL** | **R 738,000** | **R 738,000** | **R 1,476,000** |

---

## Phase 4: Enterprise & Growth (Months 7-12)

**Theme:** "B2B Enterprise, Multi-Rail Growth"

### Month 7-8: Enterprise Features

- [ ] Invoice financing (for merchants)
  - **Purpose:** Merchants can sell invoices to lenders (at 5-8% discount)
  - **ForgePay role:** Facilitate connections, handle payment routing

- [ ] SWIFT integration (international payments)
  - **Purpose:** Corporate merchants can send money to vendors abroad
  - **Compliance:** Enhanced due diligence for cross-border payments

- [ ] Merchant sub-accounts (for platforms)
  - **Purpose:** SaaS platforms (Shopify, Lemonade, Takealot) can use ForgePay as payment processor
  - **Features:** Revenue sharing (70/30 split), unified settlement

### Month 9-10: Regional Roadmap Prep

- [ ] Botswana expansion (SADC market)
  - [ ] Register BW company (minimal cost R 10,000)
  - [ ] Local bank partnerships (Botswana Pula transfers)
  - [ ] Same FSCA license applies (reciprocal agreement in SADC)

- [ ] Institutional partnerships
  - [ ] Nedbank: Co-marketing (ForgePay featured in Nedbank fintech ecosystem)
  - [ ] First National Bank (FNB): Exclusive partnership opportunity
  - [ ] Absa: Open Banking integration

### Month 11-12: Year-End & Planning

#### Operations

- [ ] Annual compliance audit
  - **FSCA:** Annual report submission
  - **POPIA:** Annual data protection audit
  - **AML/CFT:** Effectiveness report to board
  - **PCI-DSS:** Annual audit (third-party firm)

- [ ] Tax filings
  - **CIT:** Annual income tax return (due Feb 28, 2027)
  - **VAT:** Monthly returns (if >R 1M GMV)
  - **SDL:** Annual skills development levy

- [ ] Insurance renewal
  - **Professional indemnity:** Renew for next year
  - **Cyber insurance:** Renew + increase limits to R 15M (as GMV grows)

#### Planning for Year 2

- [ ] Strategic review
  - [ ] Achieved targets: Merchants, GMV, team size
  - [ ] What worked: Which payment rails, which merchant segments
  - [ ] What to improve: Technical debt, compliance gaps, UX issues

- [ ] Year 2 roadmap
  - [ ] Expansion to Botswana, Kenya
  - [ ] New features: Lending, RWA yield, trading
  - [ ] Fundraising (Series A): R 30-50M to scale to 5 countries

#### **Month 7-12 Cost Summary**

| Item | Months 7-12 (6 months) | Notes |
|------|------------------------|----|
| Engineering team (6-8 people) | R 3,500,000 | Scaling to 8 engineers |
| Non-tech (5 people) | R 1,200,000 | CSM, Finance, Compliance, BD, HR |
| AWS + infrastructure | R 700,000 | Scaling as GMV grows |
| Compliance audits | R 150,000 | Annual audits, quarterly reviews |
| Tax & accounting | R 200,000 | Bookkeeper, accountant, auditor |
| Marketing & BD | R 300,000 | Case studies, partnerships, events |
| Office + operations | R 400,000 | Larger office, utilities, phones |
| Insurance | R 60,000 | Professional indemnity + cyber |
| Integrations & tools | R 100,000 | APIs, plugins, monitoring tools |
| Contingency (10%) | R 660,000 | Buffer for unknowns |
| **TOTAL** | **R 7,270,000** | |

---

## Complete Year 1 Budget Summary

| Phase | Months | Cost | Notes |
|-------|--------|------|-------|
| **Foundation** | 1-3 | R 1,303,500 | Company setup, compliance, hiring |
| **MVP Launch** | 4 | R 438,000 | Production deployment, soft launch |
| **Scale** | 5-6 | R 1,476,000 | Hiring, features, merchant growth |
| **Enterprise Growth** | 7-12 | R 7,270,000 | Expansion features, regional prep, audits |
| **TOTAL** | | **R 10,487,500** | |

**With contingency (15% buffer):** R 12,060,625

**Recommended fundraising target:** R 15,000,000-20,000,000 (Year 1)

---

## Key Milestones & Go/No-Go Checkpoints

### Month 1: Foundation Complete

- [ ] Company registered (CIPC, TRN, SARS)
- [ ] FSCA application submitted
- [ ] Office secured
- [ ] Team hired (CTO, compliance, BD manager)
- [ ] AWS account + Terraform setup

**Go/No-Go:** If not achieved → delay launch 2-4 weeks

### Month 3: Staging Ready

- [ ] FSCA license approved or "close to approval" (no red flags)
- [ ] EKS cluster online + tested
- [ ] Bank APIs integrated (Nedbank API sandbox working)
- [ ] Pilot merchants onboarded (3-5 test merchants)
- [ ] Compliance monitoring automated

**Go/No-Go:** If compliance issues emerge → delay to Month 5

### Month 4: MVP Live

- [ ] FSCA license: **APPROVED**
- [ ] Production payment processing online
- [ ] First 10 merchants live + processing
- [ ] R 500k GMV milestone achieved
- [ ] No critical security incidents (penetration test passed)

**Go/No-Go:** If production bugs → rollback to staging, fix, relaunch Month 5

### Month 6: Scale Ready

- [ ] 50 merchants live
- [ ] R 10M+ GMV/month
- [ ] Team: 12+ people
- [ ] Automated merchant onboarding (same-day approval)
- [ ] Dashboard + API live for merchants

**Go/No-Go:** Ready for Series A fundraising

### Month 12: Year 1 Complete

- [ ] 200+ merchants
- [ ] R 100-200M cumulative GMV
- [ ] Team: 15+ people
- [ ] All annual audits passed
- [ ] Plan Year 2 expansion (Botswana, Kenya)

---

## Success Metrics (Track Monthly)

### Financial

| Metric | Month 1 | Month 3 | Month 6 | Month 12 |
|--------|---------|---------|---------|----------|
| GMV | R 0 | R 1M | R 10M | R 100-200M |
| Transaction volume | 0 | 100 | 2,000 | 30,000+ |
| Average transaction | - | R 10k | R 5k | R 5k |
| Monthly revenue | R 0 | R 25k | R 250k | R 2.5M+ |
| Monthly burn | R 600k | R 350k | R 1.2M | R 1.5M |
| Runway | - | 12 months | 12 months | 15+ months (revenue-positive by Month 18) |

### Operational

| Metric | Target | Notes |
|--------|--------|-------|
| Payment success rate | >99% | Failed card/bank txns should be <1% |
| Settlement time | <24 hours | Merchant receives funds next business day |
| Onboarding time | <3 days → <1 day (Month 6) | Speed matters for merchant acquisition |
| FSCA audit readiness | 100% | All procedures documented, no findings |
| Employee retention | 100% | No surprises; stay focused |

### Compliance

| Metric | Target | Notes |
|--------|--------|-------|
| KYC approval rate | >90% | Should approve most merchants same-day |
| SAR filed on time | 100% | All SARs within 30 days of detection |
| FSCA violations | 0 | Critical; maintain compliance record |
| Data breaches | 0 | Zero tolerance |
| Audit findings | 0 critical, <3 major | Resolve within 30 days |

---

## Contingency Plans

### Scenario 1: FSCA License Delayed (Beyond Month 6)

**Plan B:**
- Apply for "exemption" from FSCA for initial R 0-50M GMV (rare, but possible)
- Or: Partner with existing PSP (license as a sub-processor)
- **Impact:** Delays launch 2-4 months, reduces control, less attractive to merchants
- **Mitigation:** Hire best external compliance advisor early (Big 4 firm)

### Scenario 2: Bank API Integration Fails (Nedbank Doesn't Cooperate)

**Plan B:**
- Use Plaid exclusively for bank connections (higher cost, but works)
- Or: Partner with payment aggregator (like Fiserv, FIS, Jack Henry)
- **Impact:** Reduces competitive advantage, higher costs (Plaid ~3% vs bank API ~1%)
- **Mitigation:** Multi-bank strategy from day 1 (Nedbank + FNB + Plaid)

### Scenario 3: First Merchants Churn (Unsatisfied)

**Plan B:**
- Extend free trial (wave transaction fees for 3 months)
- Or: Offer white-label dashboard (custom branding)
- **Impact:** Reduces revenue, but keeps merchants
- **Mitigation:** Personal support, weekly check-ins, product feedback loop

### Scenario 4: Security Incident (Hacked)

**Plan B:**
- Immediate lockdown (freeze all transactions)
- Third-party incident response firm (R 50,000-100,000)
- Notify FSCA + affected merchants within 24 hours
- **Impact:** 1-2 week shutdown, regulatory scrutiny, customer loss
- **Mitigation:** Security-first culture, regular penetration tests, cyber insurance

---

## Monthly Review Template

Use this template each month to track progress:

```
MONTHLY REVIEW — [MONTH/YEAR]
=============================

Achieved:
□ [Milestone 1]
□ [Milestone 2]
□ [Milestone 3]

Not Achieved (Reason):
□ [Blocker 1] — Impact: [X]
□ [Blocker 2] — Impact: [X]

Financials:
- Burn: R [X] (target: R [X])
- GMV: R [X] (target: R [X])
- Merchants: [X] (target: [X])
- Revenue: R [X] (target: R [X])

Team:
- Hired: [Names] (roles: [Titles])
- Departures: [None / Name] (reason: [X])
- Morale: [Good / OK / Concerning]

Compliance:
- FSCA status: [Approved / In-review / Approved with conditions]
- SARs filed: [0 / X]
- Security incidents: [0 / X]

Next Month Priorities:
1. [Priority 1]
2. [Priority 2]
3. [Priority 3]

Risks to Watch:
- [Risk 1] — Mitigation: [X]
- [Risk 2] — Mitigation: [X]
```

---

## Regional Expansion Roadmap (Year 2+)

### Botswana (Month 15-18)

- **Register:** Botswana company (minimal cost)
- **Bank partnerships:** Botswana Pula transfers (First National Bank, Barclays, BMTC)
- **Regulation:** Use FSCA license (reciprocal with Botswana)
- **Target:** R 50M GMV within 12 months

### Kenya (Month 18-24)

- **Register:** Kenya company (separate license with CBK)
- **Partners:** Safaricom M-Pesa, Kenya Commercial Bank (KCB), Equity Bank
- **Regulation:** Central Bank of Kenya (CBK) license (6-12 months)
- **Target:** R 100M+ GMV within 12 months (larger market than ZA)

### Nigeria (Year 3)

- **Register:** Nigeria company (complex regulation)
- **Regulation:** CBN (Central Bank of Nigeria) + SEC licenses (12-18 months)
- **Partners:** Flutterwave, Paystack, or build direct bank integrations
- **Target:** R 500M+ GMV (largest African market)

---

**Last Updated:** June 2026  
**Status:** Ready for Execution  
**Next: Execute Month 1 Foundation Phase**
