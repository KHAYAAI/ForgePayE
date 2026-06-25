# ForgePay South Africa Deployment Documentation

Welcome to the comprehensive ForgePay South Africa deployment guide. This directory contains everything needed to launch ForgePay as a regulated payment processor in South Africa and expand across Africa.

## 📚 Document Overview

### 1. **SOUTH_AFRICA_DEPLOYMENT.md** (Primary Infrastructure Guide)
**What:** AWS architecture, infrastructure-as-code templates, and operations guide  
**Who should read:** CTOs, DevOps engineers, infrastructure teams  
**Key sections:**
- AWS af-south-1 (Cape Town) vs eu-west-1 (Ireland) architecture
- EKS Kubernetes cluster setup (Terraform code included)
- RDS Aurora, ElastiCache Redis, S3 configuration
- Monthly cost estimate (R 69,660 baseline)
- Performance optimization tips
- Disaster recovery procedures (RTO 4h, RPO 1h)
- CloudWatch/Prometheus monitoring setup

**Timeline:** Read first if building infrastructure  
**Action items:** Deploy EKS cluster by Month 2

---

### 2. **SOUTH_AFRICA_LICENSES.md** (Regulatory & Compliance Guide)
**What:** Complete regulatory framework for South Africa payment processing  
**Who should read:** Founders, compliance officers, legal teams  
**Key sections:**
- **FSCA** — Money Transmitter License (core requirement, 6-12 months)
- **FIC** — Suspicious Activity Reporting (AML/CFT compliance)
- **POPIA** — Data Protection Officer requirements
- **SARB** — Payment System Operator (optional, Year 2+)
- **Tax Compliance** — SARS obligations (28% CIT, 15% VAT)
- **Crypto Regulations** — Stablecoins, Bitcoin, tax treatment
- Complete SAR templates (how to file with FIC)
- Compliance calendar (quarterly/annual audit schedule)

**Timeline:** Start Month 1, FSCA approval expected Month 4-6  
**Action items:** 
- [ ] Register company (CIPC) by end of Month 1
- [ ] File FSCA application by end of Month 2
- [ ] Receive approval by Month 4

---

### 3. **TEAM_STRUCTURE_SOUTH_AFRICA.md** (Hiring & Organization)
**What:** Complete HR guide for building ForgePay South Africa team  
**Who should read:** Founders, HR managers, finance officers  
**Key sections:**
- MVP team (6 people, Month 1-3): CTO, engineers, compliance, business dev
- Scale team (12-15 people, Month 4-12): Additional engineers, customer success, finance
- Salary benchmarks (engineers R 70-200k/month depending on seniority)
- Equity allocation (50% for early team, 10-15% employee pool)
- Hiring timeline (6-8 weeks per hire)
- South African employment law (BCEA, employment contracts, taxes)
- Onboarding checklist
- Performance management
- Culture & remote work policy

**Timeline:** Start recruiting Month 1 (CTO/compliance), Month 2+ (engineers)  
**Action items:**
- [ ] Hire CTO by Month 2
- [ ] Hire backend engineer #1 by Month 2
- [ ] Hire DevOps by Month 2
- [ ] Hire compliance officer (part-time) by Month 1

---

### 4. **SOUTH_AFRICA_ROADMAP.md** (Month-by-Month Launch Plan)
**What:** Complete 12-month execution plan with milestones, costs, and go/no-go checkpoints  
**Who should read:** Project managers, CEOs, board members  
**Key sections:**
- **Phase 1 (Months 1-3):** Company setup, regulatory foundation, bank integration
- **Phase 2 (Month 4):** MVP launch with FSCA approval
- **Phase 3 (Months 5-6):** Scale to 50 merchants, enterprise features
- **Phase 4 (Months 7-12):** Regional expansion prep, annual audits
- Detailed week-by-week breakdowns
- Monthly cost summary (R 10.5M total Year 1)
- Success metrics dashboard
- Contingency plans (FSCA delays, bank integration failures, etc.)
- Go/no-go checkpoints at key milestones

**Timeline:** Execute Month 1-12 in sequence  
**Action items:** Follow the roadmap; review monthly

---

### 5. **SOUTH_AFRICA_COMPLIANCE_PLAYBOOK.md** (Day-to-Day Operations)
**What:** Operational procedures for AML/CFT compliance, merchant monitoring, SAR filing  
**Who should read:** Compliance officers, operations managers  
**Key sections:**
- **Daily operations:** Transaction monitoring (automated + manual review)
- **Weekly tasks:** Merchant risk assessment, SAR review
- **Monthly reports:** Board reports, financial summaries, regulatory status
- **Quarterly audits:** Full compliance audits, staff training
- **Annual audits:** FSCA reporting, PCI-DSS audit, POPIA audit
- Complete SAR (Suspicious Activity Report) filing process with templates
- Merchant suspension protocol
- AML/CFT training schedule
- Common money laundering typologies for South Africa
- Monthly compliance checklist

**Timeline:** Implement before going live (Month 4)  
**Action items:** Build compliance-monitor service by Month 3

---

### 6. **aws_south_africa_cost_calculator.py** (Cost Estimation Tool)
**What:** Python tool to estimate AWS costs based on GMV, merchants, transaction volume  
**Who should read:** Finance teams, CFOs, investors  
**Usage:**
```bash
# MVP scenario
python aws_south_africa_cost_calculator.py --gmv 500000 --merchants 5 --txns-per-day 500

# Month 3 scenario
python aws_south_africa_cost_calculator.py --gmv 10000000 --merchants 50 --txns-per-day 2000

# Year 1 target
python aws_south_africa_cost_calculator.py --gmv 150000000 --merchants 200 --txns-per-day 30000
```

**Output:** Detailed breakdown of EKS, RDS, ElastiCache, data transfer, security, observability costs  
**Features:**
- Monthly and annual cost estimates (ZAR + USD)
- Per-unit costs (cost/merchant, cost/transaction)
- Scaling projections (R 1M → R 100M GMV)
- Cost optimization recommendations

---

### 7. **SOUTH_AFRICA_REGIONAL_EXPANSION.md** (Years 2-3 Growth)
**What:** Roadmap for expanding ForgePay across Africa (Botswana, Namibia, Kenya, Rwanda, Nigeria)  
**Who should read:** Founders, strategic planners, investors  
**Key sections:**
- **Phase 1 SADC (Year 2):**
  - Botswana: 3-month launch (M 13-15)
  - Namibia: 3-month launch (M 16-18)
- **Phase 2 East Africa (Year 2-3):**
  - Kenya: 9-month complex launch (M 19-27) — M-Pesa integration key
  - Rwanda: 9-month launch (M 22-30)
- **Phase 3 West Africa (Year 3+):**
  - Nigeria: Partnership strategy (too complex for independent entry)
- Regulatory requirements per country
- Bank partnership strategies
- Payment rail integrations (M-Pesa, SWIFT, crypto)
- Financing & fundraising strategy (Series A: R 100-150M, Series B: R 300-500M)
- Financial projections (Year 3: R 1-2B GMV)

**Timeline:** Botswana launch Month 13, Kenya Month 19  
**Action items:** Prepare regulatory applications Month 12-13

---

## 🚀 Quick Start Guide

### Week 1-2 (Month 1)

1. **Read SOUTH_AFRICA_DEPLOYMENT.md** — Understand infrastructure approach
2. **Read SOUTH_AFRICA_LICENSES.md** — Understand regulatory requirements
3. **Read TEAM_STRUCTURE_SOUTH_AFRICA.md** — Start recruiting

### Week 2-4 (Month 1)

4. **Read SOUTH_AFRICA_ROADMAP.md** — Create month-by-month plan
5. **Create project timeline** — Use roadmap + assign owners
6. **Start regulatory prep:**
   - Register company (CIPC)
   - Get TRN (SARS)
   - File FSCA application

### Month 2-3

7. **Read SOUTH_AFRICA_COMPLIANCE_PLAYBOOK.md** — Build compliance team
8. **Deploy infrastructure** — EKS cluster, RDS, ElastiCache
9. **Bank integrations** — Nedbank OpenAPI, Plaid ZA setup
10. **Merchant onboarding** — Build KYC/AML workflows

### Month 4+

11. **FSCA approval** — Should be achieved by now
12. **Go live** — Deploy to production
13. **Read aws_south_africa_cost_calculator.py** — Monitor costs
14. **Scale** — Hire additional engineers, expand features

### Month 13+

15. **Read SOUTH_AFRICA_REGIONAL_EXPANSION.md** — Plan Botswana/Kenya
16. **Execute regional launches** — Follow phase 1-3 timelines

---

## 💰 Financial Summary

### Year 1 Investment

| Category | Cost (ZAR) | Notes |
|----------|-----------|-------|
| **Salaries & Team** | R 8.7M | MVP (6) → Scale (15) |
| **Regulatory & Compliance** | R 350k | FSCA, audit, DPO |
| **AWS Infrastructure** | R 850k | af-south-1 + eu-west-1 |
| **Office & Operations** | R 600k | Cape Town/Johannesburg |
| **Legal & Tax Setup** | R 350k | Company, contracts, filings |
| **Marketing & Business Dev** | R 700k | Partnerships, merchant recruitment |
| **Contingency (10%)** | R 1.4M | Buffer for unknowns |
| **TOTAL** | **R 13M** | **Annual investment** |

### Fundraising Targets

- **Seed Round (Year 1):** R 15-20M
- **Series A (Year 2):** R 100-150M (regional expansion)
- **Series B (Year 3):** R 300-500M (scale to profitability)

### Unit Economics (Year 1 - Target)

| Metric | Target |
|--------|--------|
| Transaction fee (average) | 2.5% |
| Monthly GMV (Month 12) | R 100-200M |
| Monthly revenue (Month 12) | R 2.5-5M |
| Merchant LTV | R 250k (50-month payback) |
| Customer acquisition cost | R 5k/merchant |
| Monthly burn (Month 12) | R 1.5M |
| Runway (with seed funding) | 12-15 months |

---

## ✅ Key Milestones (Go/No-Go)

### Checkpoint 1: End of Month 1 — Foundation
- [ ] Company registered (CIPC, TRN, SARS)
- [ ] FSCA application submitted
- [ ] Core team hired (CTO, compliance, BD)
- [ ] Office secured
- [ ] AWS account setup

**Go/No-Go Decision:** Proceed to Month 2 ✓

### Checkpoint 2: End of Month 3 — Ready to Launch
- [ ] FSCA approval or "on track" (no red flags)
- [ ] EKS cluster deployed + tested
- [ ] Bank APIs working (Nedbank/Plaid)
- [ ] Pilot merchants onboarded (3-5)
- [ ] Compliance monitoring automated

**Go/No-Go Decision:** Proceed to Month 4 MVP launch ✓

### Checkpoint 3: End of Month 6 — Scaling
- [ ] 50+ merchants live
- [ ] R 10M+ monthly GMV
- [ ] 12+ team members
- [ ] All annual audits on track
- [ ] Ready for Series A fundraising

**Go/No-Go Decision:** Proceed to regional expansion (Month 13) ✓

### Checkpoint 4: End of Month 12 — Year 1 Complete
- [ ] 200+ merchants
- [ ] R 100-200M cumulative GMV
- [ ] 15+ team members
- [ ] All regulatory audits passed
- [ ] Series A funded or in progress

**Go/No-Go Decision:** Ready for Africa expansion ✓

---

## 📞 Key Contacts & Resources

### South African Regulators

| Authority | Contact | Website |
|-----------|---------|---------|
| **FSCA** | 086 110 2927 | www.fsca.org.za |
| **SARB** | 012 313 3911 | www.resbank.co.za |
| **FIC** | 012 315 1234 | www.fic.gov.za |
| **SARS** | 0800 00 7277 | www.sars.gov.za |
| **CIPC** | 0861 161 630 | www.cipc.co.za |

### Recommended Service Providers

| Service | Firm | Type | Cost |
|---------|------|------|------|
| **Legal** | Bowmans, Clifford Chance | Corporate, payment law | R 30-50k/month |
| **Compliance Audit** | Deloitte, EY, KPMG | AML/CFT, FSCA | R 50-100k/year |
| **Accounting** | Local bookkeeper + Big 4 | Tax, VAT, CIT | R 10-20k/month |
| **Recruitment** | Michael Page, LinkedIn Recruiter | Hiring (tech + non-tech) | 15-20% of salary |
| **DPO** | External DPO firm | POPIA compliance | R 3-5k/month |

### Useful Resources

- **FSCA License Guide:** www.fsca.org.za/regulatory-framework/money-transmitter
- **FIC SAR Portal:** www.fic.gov.za/sars/
- **SARS eFiling:** www.sars.gov.za/individuals/filing/
- **ForgePay CLAUDE.md:** See /home/user/ForgePayE/CLAUDE.md for codebase context

---

## 🔄 Document Relationships

```
README_SOUTH_AFRICA.md (this file)
├─ SOUTH_AFRICA_DEPLOYMENT.md (infrastructure)
│   └─ Links to: aws_south_africa_cost_calculator.py
├─ SOUTH_AFRICA_LICENSES.md (regulatory)
├─ TEAM_STRUCTURE_SOUTH_AFRICA.md (hiring)
├─ SOUTH_AFRICA_ROADMAP.md (execution)
│   └─ Integrates: Deployment + Licenses + Team
├─ SOUTH_AFRICA_COMPLIANCE_PLAYBOOK.md (operations)
└─ SOUTH_AFRICA_REGIONAL_EXPANSION.md (growth, Years 2-3)
```

---

## 📖 How to Use These Documents

### For Founders
1. Read: ROADMAP (overview of timeline)
2. Read: LICENSES (what needs approval)
3. Skim: TEAM_STRUCTURE (hiring planning)
4. Reference: Others as needed

### For CTO/Engineers
1. Read: DEPLOYMENT (infrastructure)
2. Skim: ROADMAP (timeline)
3. Reference: Playbook (compliance requirements for code)

### For Compliance Officer
1. Read: LICENSES (regulatory requirements)
2. Read: PLAYBOOK (day-to-day operations)
3. Reference: ROADMAP (compliance milestones)

### For CFO/Finance
1. Read: ROADMAP (costs)
2. Run: aws_south_africa_cost_calculator.py (project costs)
3. Reference: TEAM_STRUCTURE (salary costs)

### For Investors
1. Read: ROADMAP (12-month plan)
2. Read: REGIONAL_EXPANSION (years 2-3+ opportunity)
3. Skim: Others for deep dives

---

## 🎯 Success Criteria (12 Months)

**Financial:**
- R 100-200M cumulative GMV
- R 2.5-5M monthly revenue (Month 12)
- -R 7-10M net loss (acceptable for growth-stage fintech)

**Operational:**
- 200+ active merchants
- 99.95% uptime (payment processing SLA)
- <2 second p99 latency for transactions

**Regulatory:**
- FSCA license: Approved ✓
- Zero compliance violations
- All annual audits passed

**Team:**
- 15+ people (engineers, ops, business)
- Zero critical departures
- Strong culture & engagement

---

## 📝 Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | June 25, 2026 | Claude Code | Initial comprehensive deployment guide |

---

## ❓ FAQ

**Q: Can we launch before getting FSCA approval?**  
A: No. FSCA license is regulatory requirement. You cannot legally process payments without it. Start application Month 1-2, expect approval Month 4-6.

**Q: What if we can't find a CTO?**  
A: Consider hiring CTO from UK/EU (remote, with ZA equity). ZA tech talent is scarce; international talent will require equity incentive. Budget 12 weeks for search.

**Q: Can we skip the compliance officer?**  
A: No. FSCA requires dedicated compliance officer. Start with part-time contractor (Big 4 firm) Month 1, hire full-time by Month 3-4.

**Q: What's the biggest risk?**  
A: FSCA license delay. Mitigation: Hire best compliance advisor early, submit application 2 months before target launch.

**Q: Can we launch in multiple countries simultaneously?**  
A: No. Build in South Africa first (12 months), then expand to Botswana. Each country needs separate regulatory approval.

**Q: What about fundraising?**  
A: Raise R 15-20M before Month 1 (pre-launch). Use for Year 1 operations. Plan Series A (R 100-150M) for Month 18-24 (regional expansion).

---

**Last Updated:** June 25, 2026  
**Status:** Ready for Execution  
**Next Action:** Read SOUTH_AFRICA_ROADMAP.md and start Month 1 tasks

---

**Contact:** cashmoneytebza@gmail.com  
**Location:** Cape Town, South Africa (af-south-1)  
**Vision:** ForgePay — The African Payment Engine
