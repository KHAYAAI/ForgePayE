# ForgePay South Africa: Team Structure & Hiring Guide

## Executive Summary

**Launch Location:** Cape Town or Johannesburg  
**MVP Team Size:** 6 people  
**Scale Team Size (Month 6):** 12-15 people  
**Year 1 Burn Rate:** R 1.2M-1.5M/month (MVP) → R 3M-3.5M/month (scale team)  
**Total Year 1 Payroll:** R 8.7M-10.5M

---

## 1. Minimum Viable Team (MVP) — Months 1-3

**Objective:** Launch payment processing in South Africa with core compliance  
**Total Monthly Payroll:** R 540,000-720,000  
**Office Location:** Cape Town or Johannesburg (shared office, not dedicated space yet)

### Team Composition

#### 1. CEO / Founder
**Reports to:** Board/Investors  
**Reports:** Everyone (direct)

**Responsibilities:**
- Overall business strategy and vision
- Fundraising (institutional investors, impact funds)
- Strategic partnerships (banks, payment networks, government)
- Board management and reporting
- Risk management (financial, regulatory, reputational)

**Qualifications:**
- 10+ years in fintech or payments
- Track record of successful fundraising (at least R 5M)
- Understanding of payment systems and regulations
- Leadership experience (managed 5+ team members)

**Required Skills:**
- Strategic thinking and business development
- Regulatory understanding (at least FSCA basics)
- Financial modeling
- Communication (to investors, regulators, press)

**Time Commitment:** 100% (full-time)

**Salary Range:** R 80,000-120,000/month  
**Equity:** 25%  
**Benefits:** Medical (top-tier), retirement (12%), phone stipend, home office

**Hiring Timeline:**
- If you're the founder: skip this role (you are CEO)
- If hiring CEO: 4-6 weeks (C-suite search, expensive executive recruiter)

---

#### 2. CTO / Lead Engineer
**Reports to:** CEO  
**Reports:** Backend engineers, DevOps

**Responsibilities:**
- Architecture decisions (AWS af-south-1, EKS, payment routing)
- Code quality and security (payment PCI compliance)
- Payment processing system reliability (99.95% uptime target)
- Technology hiring (recruiting engineers for team)
- Vendor evaluation (payment networks, bank APIs, KMS providers)

**Qualifications:**
- 7+ years software engineering (5+ in payments or fintech)
- Deep Rust experience (Hyperswitch is Rust)
- Kubernetes/DevOps knowledge (EKS operations)
- Payment systems understanding (settlement, reconciliation, webhooks)
- Security mindset (has shipped PCI-DSS systems before)

**Required Skills:**
- Rust (must-have)
- Kubernetes + Terraform (infrastructure-as-code)
- PostgreSQL/database optimization
- Distributed systems architecture
- AWS (EKS, RDS, ElastiCache, Lambda)

**Time Commitment:** 100% (full-time)

**Salary Range:** R 120,000-150,000/month  
**Equity:** 10%  
**Benefits:** Medical (top-tier), retirement (12%), home office stipend (R 3,000/month), conference budget (R 20,000/year)

**Hiring Timeline:**
- Difficulty: HIGH (senior engineers are scarce in ZA)
- Timeline: 8-12 weeks
- Approach: LinkedIn + tech community outreach (Jozi Connect, Cape Town Tech)
- Offer package is critical (equity + remote work flexibility likely needed)

**Alternative:** Hire CTO from UK/EU remotely (UK engineer ~£100k, South African equity makes it attractive)

---

#### 3. Backend Engineer
**Reports to:** CTO  
**Reports:** None (individual contributor)

**Responsibilities:**
- Implement payment features (transaction processing, refunds)
- Build unified-router service (webhook normalizer)
- Implement AML/CFT compliance logic (compliance-monitor)
- Database schema design and optimization
- API endpoint development (RESTful + gRPC)
- Code reviews for other engineers

**Qualifications:**
- 4+ years software engineering
- 2+ years in backend systems
- TypeScript or Python (for non-Rust services)
- Database experience (SQL, relational modeling)
- API design experience

**Required Skills:**
- TypeScript (fastify, Express) or Python (FastAPI)
- PostgreSQL + query optimization
- REST API design
- Distributed systems (eventual consistency, idempotency)
- Testing (unit, integration, end-to-end)

**Time Commitment:** 100% (full-time)

**Salary Range:** R 90,000-120,000/month  
**Equity:** 3%  
**Benefits:** Medical, retirement (12%), home office stipend

**Hiring Timeline:**
- Difficulty: MEDIUM (mid-level engineers more available)
- Timeline: 4-6 weeks
- Approach: LinkedIn, Stack Overflow Jobs, tech community

---

#### 4. DevOps / Platform Engineer
**Reports to:** CTO  
**Reports:** None (individual contributor)

**Responsibilities:**
- AWS infrastructure management (EKS, RDS, ElastiCache)
- Terraform code (IaC for reproducible deployments)
- CI/CD pipeline setup (GitHub Actions, ArgoCD for GitOps)
- Monitoring and observability (CloudWatch, Prometheus, Grafana)
- Disaster recovery and backup procedures
- Security hardening (VPC, security groups, WAF, KMS)
- On-call rotation (handle production incidents, 24/7 alerting)

**Qualifications:**
- 5+ years DevOps/platform engineering
- AWS expertise (EKS, RDS, networking, security)
- Infrastructure-as-code (Terraform, Helm)
- Kubernetes operations (node management, pod deployment)
- Python or Bash scripting

**Required Skills:**
- AWS (expert level: VPC, IAM, KMS, secrets management)
- Kubernetes (kubeconfig, RBAC, namespaces, deployments)
- Terraform (modules, state management, best practices)
- CI/CD tools (GitHub Actions, ArgoCD)
- Linux/networking (TCP/IP, DNS, firewall rules)
- Monitoring (CloudWatch, Prometheus, alert design)

**Time Commitment:** 100% (full-time) + on-call rotation (1 week every 6 weeks, nights/weekends)

**Salary Range:** R 100,000-130,000/month  
**Equity:** 3%  
**Benefits:** Medical (top-tier, covers stress), retirement (12%), on-call allowance (R 1,000/week when on-call), home office

**Hiring Timeline:**
- Difficulty: HIGH (very specialized, few available in ZA)
- Timeline: 8-12 weeks
- Approach: DevOps community, cloud provider programs, recruitment agencies

---

#### 5. Compliance Officer
**Reports to:** CEO  
**Reports:** None (individual contributor)

**Responsibilities:**
- FSCA license application and ongoing compliance
- AML/CFT program design and implementation
- SAR (Suspicious Activity Report) filing with FIC
- Merchant KYC (Know Your Customer) review and approval
- AML/CFT staff training
- Monthly compliance reports to board
- Regulatory liaison (FSCA, FIC, SARB)
- Tax and POPIA coordination

**Qualifications:**
- 10+ years compliance or regulatory experience
- FSCA or banking regulation background (South African experience preferred)
- AML/CFT certification (ACAMS or equivalent)
- Legal background (JD or LLB preferred)
- Audit or accounting background

**Required Skills:**
- FSCA regulations (FAIS Act, POCA, FICA)
- AML/CFT methodologies (customer due diligence, transaction monitoring, SAR)
- Risk assessment and KYC procedures
- Documentation and audit trail management
- Strong communication (to non-technical team)
- Financial analysis (understand merchant risk profiles)

**Time Commitment:** 100% (full-time)

**Salary Range:** R 80,000-100,000/month  
**Equity:** 2%  
**Benefits:** Medical, retirement (12%), home office, professional development (R 10,000/year for ACAMS training)

**Note:** VERY specialized role. Compliance officers in South Africa are expensive (R 80-150k/month) due to scarcity of FSCA-experienced professionals.

**Hiring Timeline:**
- Difficulty: VERY HIGH (only few FSCA-experienced officers in SA)
- Timeline: 12-16 weeks (may need to hire externally from Big 4 audit firms initially)
- Approach: Big 4 firms (Deloitte, EY, KPMG, PwC) for interim roles, then hire full-time

**Interim Solution:** Hire Big 4 compliance consultant (R 5,000-10,000/month part-time, 20 hours/week) for first 3 months while recruiting full-time officer.

---

#### 6. Business Development / Partnerships Manager
**Reports to:** CEO  
**Reports:** None (individual contributor)

**Responsibilities:**
- Bank relationship management (Nedbank, FNB, Absa, Standard Bank)
- Merchant onboarding and support
- Strategic partnerships (payment networks, crypto exchanges)
- Customer communication and account management
- Roadmap input (what merchants need, what to build next)
- Sales support (help close enterprise merchants)

**Qualifications:**
- 5+ years in fintech, payments, or business development
- Banking or payment network relationships (in South Africa)
- Sales or account management background
- Entrepreneur mindset (comfortable with ambiguity)

**Required Skills:**
- Relationship building and networking
- Sales and negotiation
- Understanding of South African banking ecosystem
- Product knowledge (once you've built ForgePay)
- Communication and presentation

**Time Commitment:** 100% (full-time) + travel (10-20% of time, bank meetings in Johannesburg/Pretoria)

**Salary Range:** R 70,000-100,000/month + commission (2-5% of first-year merchant value, up to R 20,000/month)  
**Equity:** 1%  
**Benefits:** Medical, retirement (12%), travel allowance (R 3,000/month), phone + laptop

**Hiring Timeline:**
- Difficulty: MEDIUM (relationship-focused, many available)
- Timeline: 4-6 weeks
- Approach: Fintech community, payment networks, bank referrals

---

### MVP Team Summary

| Role | Salary (ZAR) | Equity | Total Cost |
|------|--------------|--------|-----------|
| CEO / Founder | R 100,000 | 25% | Included (co-founder expected) |
| CTO / Lead Engineer | R 135,000 | 10% | R 135,000 |
| Backend Engineer | R 105,000 | 3% | R 105,000 |
| DevOps / Platform Eng. | R 115,000 | 3% | R 115,000 |
| Compliance Officer | R 90,000 | 2% | R 90,000 |
| Business Dev Manager | R 85,000 + commission | 1% | R 95,000 (avg, with commission) |
| **TOTAL** | | **44%** | **R 540,000/month** |

**Add 20% for benefits (medical, retirement, phone, home office), brings total to R 650,000/month.**

---

## 2. Scale Team (Months 4-12)

### Additional Hires (5-7 more engineers)

After MVP launch, add these roles:

#### Backend Engineer #2 (Month 4)
**Language:** Python  
**Purpose:** Develop mor-layer (tax calculation, checkout, yield engine)  
**Salary:** R 90,000-120,000/month  
**Equity:** 3%

#### Blockchain Engineer (Month 5)
**Languages:** TypeScript, Solidity  
**Purpose:** Maintain stablecoin-gateway, crypto-gateway, DeFi integrations  
**Qualifications:** 3+ years Web3, 2+ years Solidity  
**Salary:** R 100,000-150,000/month (crypto engineers expensive in ZA)  
**Equity:** 3%

#### Frontend Engineer (Month 5)
**Language:** TypeScript (React, Next.js)  
**Purpose:** Merchant dashboard, customer checkout  
**Qualifications:** 3+ years React, Next.js experience  
**Salary:** R 80,000-120,000/month  
**Equity:** 2%

#### QA / Test Automation Engineer (Month 6)
**Languages:** TypeScript, Python  
**Purpose:** End-to-end testing, load testing, regression suites  
**Qualifications:** 3+ years QA automation, load testing tools (k6, JMeter)  
**Salary:** R 70,000-100,000/month  
**Equity:** 2%

#### DevOps / SRE #2 (Month 6)
**Purpose:** Second on-call engineer, infrastructure scaling  
**Same qualifications as DevOps #1  
**Salary:** R 100,000-130,000/month  
**Equity:** 2%

---

### Non-Technical Hires (3 more)

#### Customer Success Manager (Month 4)
**Purpose:** Merchant support, onboarding, technical account management  
**Qualifications:** 2+ years in fintech/payments customer success  
**Salary:** R 50,000-80,000/month  
**Equity:** 1%

#### Financial Controller (Month 5)
**Purpose:** Monthly P&L, tax filings, reconciliation  
**Qualifications:** 5+ years accounting, SARS experience, QuickBooks/Sage  
**Salary:** R 60,000-90,000/month  
**Equity:** 1%

#### Compliance Analyst (Month 6)
**Purpose:** AML/CFT monitoring, SAR filing, ongoing KYC reviews  
**Qualifications:** 2+ years compliance, ACAMS certification  
**Salary:** R 50,000-70,000/month  
**Equity:** 0.5%

---

### Scale Team Summary (12-15 people, Month 6-12)

| Role | Count | Monthly Payroll |
|------|-------|-----------------|
| MVP Team (6) | 1 | R 540,000 |
| Backend Engineers | 2 | R 195,000 |
| Blockchain Engineer | 1 | R 125,000 |
| Frontend Engineer | 1 | R 100,000 |
| QA Engineer | 1 | R 85,000 |
| DevOps / SRE | 2 | R 230,000 |
| Customer Success Manager | 1 | R 65,000 |
| Financial Controller | 1 | R 75,000 |
| Compliance Analyst | 1 | R 60,000 |
| **TOTAL (12 people)** | | **R 1,475,000** |
| **With benefits (20%)** | | **R 1,770,000/month** |

---

## 3. South African Hiring Practices

### Where to Hire

#### Online Platforms

| Platform | Best For | Cost | Notes |
|----------|----------|------|-------|
| **LinkedIn South Africa** | All levels, passive candidates | Free (posting) + R 20k for recruiter | Most effective for mid-to-senior hires |
| **Stack Overflow Jobs** | Engineers, developers | Free posting + ~R 5k per featured | Strong technical talent pool |
| **iKamva** | Junior developers (bootcamp grads) | Free | Emerging talent, lower cost |
| **Gumtree** | Junior to mid-level | R 500-2,000 per posting | High volume but lower quality |
| **Indeed South Africa** | All levels | ~R 2,000 per posting | General recruitment, high volume |

#### Local Communities & Conferences

- **Jozi Connect (Johannesburg)** — Monthly meetup, tech leaders
- **Cape Town Tech** — Active community in Cape Town
- **Pycon ZA** — Python developers
- **ZA Dev Community** — Slack group for South African developers
- **Startup Grind Cape Town/Johannesburg** — Entrepreneurs and business leaders
- **Fintech Association of South Africa** — Compliance, business development

#### Universities (Graduate Recruitment)

- **University of Cape Town (UCT)** — Computer Science department
- **Stellenbosch University** — Strong engineering program
- **University of Witwatersrand (Wits)** — Johannesburg-based, large tech community
- **University of Johannesburg (UJ)** — Engineering focus

#### Recruitment Agencies

| Agency | Specialty | Cost | Notes |
|--------|-----------|------|-------|
| **Deloitte Consulting** | Senior hires (CTO, CFO level) | 20-25% of annual salary | Expensive, high quality |
| **Heidrick & Struggles** | Executive search, board-level | 25-30% of annual salary | Very expensive, premium |
| **Michael Page** | Mid-to-senior hires | 15-20% of annual salary | Good for permanent staff |
| **Absolute Technology Recruitment** | Tech roles (engineers, DevOps) | 15-20% of annual salary | Tech-specialized |
| **Recruitment Direct** | Junior to mid-level | 10-15% of annual salary | Good for junior fills |

---

### South African Salary Benchmarks (2026)

All salaries in ZAR/month for Cape Town and Johannesburg markets:

| Role | Junior (2-3 yrs) | Mid (4-6 yrs) | Senior (7+ yrs) |
|------|------------------|---------------|-----------------|
| **Backend Engineer** | R 50-70k | R 80-120k | R 120-180k |
| **Frontend Engineer** | R 45-65k | R 75-110k | R 110-160k |
| **DevOps / Platform Eng.** | R 60-85k | R 95-140k | R 140-200k |
| **Blockchain Engineer** | R 70-100k | R 110-160k | R 160-250k (scarce) |
| **QA Automation** | R 40-60k | R 70-100k | R 100-150k |
| **Compliance Officer** | N/A | R 70-100k | R 100-150k |
| **Customer Success** | R 35-55k | R 55-85k | R 85-120k |
| **Financial Controller** | R 50-75k | R 75-100k | R 100-150k |
| **CTO / Tech Lead** | N/A | R 120-160k | R 160-200k+ |

**Cost of Living Adjustment (vs London):**
- Cape Town: ~30% cheaper than London
- Johannesburg: ~25% cheaper than London
- Pretoria: ~35% cheaper than London

---

### Equity Allocation Recommendation

**Total Equity Pool:** 50-55% (for founding team + early hires)

| Group | Allocation | Details |
|-------|-----------|---------|
| **Founder/CEO** | 25% | Standard for solo founder + investor |
| **CTO + Early Eng** | 15% | 10% CTO, 3% each for 2 engineers |
| **Other Early Hires** | 6% | 2% compliance, 1-2% other |
| **Employee Pool** | 10-15% | Vesting for future hires (4-year vest, 1-year cliff) |
| **Board/Advisors** | 3-5% | Investors, external advisors |
| **Reserve** | 5-10% | Future hires, options pool |

**Vesting Schedule (Standard in SA tech):**
- 4-year vest: 25% per year
- 1-year cliff: No shares if employee leaves before year 1
- Monthly vest after cliff

**Equity Strike Price (for tax efficiency in SA):**
- SARS allows R 0.01 per share (nominal) for startup equity grants
- Document FMV (fair market value) in board minutes
- Avoid R 0 strike price (tax audit risk)

---

## 4. Compensation & Benefits

### Salary Structure (South Africa)

**Base Salary (80% of total comp)**
- Paid monthly, by 25th of month (legal requirement)
- Fixed for 1 year (annual review thereafter)

**Performance Bonus (10% of total comp)**
- Annual bonus (usually paid in December)
- Based on KPIs (see below)

**Benefits (10% of total comp)**
- Medical aid (R 2,500-4,000/month for individual)
- Retirement/Pension (12% employer contribution minimum)
- Phone stipend (R 500-1,000/month)
- Home office stipend (R 2,000-3,000/month)
- Internet stipend (R 500/month)
- Professional development (R 5,000-20,000/year depending on role)

### Sample Compensation Packages

#### CTO Package (Total: R 160,000/month)

| Component | Amount |
|-----------|--------|
| Base salary | R 135,000 |
| Performance bonus (annual, 10%) | R 13,500 |
| Medical aid | R 4,000 |
| Retirement (12%) | R 16,200 |
| Phone | R 1,000 |
| Home office | R 3,000 |
| Prof dev | R 1,500 |
| **TOTAL** | **R 174,200/month** |

#### Backend Engineer Package (Total: R 125,000/month)

| Component | Amount |
|-----------|--------|
| Base salary | R 105,000 |
| Performance bonus (annual, 10%) | R 10,500 |
| Medical aid | R 3,500 |
| Retirement (12%) | R 12,600 |
| Phone | R 800 |
| Home office | R 2,000 |
| **TOTAL** | **R 134,400/month** |

#### Compliance Officer Package (Total: R 110,000/month)

| Component | Amount |
|-----------|--------|
| Base salary | R 90,000 |
| Performance bonus (annual, 10%) | R 9,000 |
| Medical aid | R 4,000 |
| Retirement (12%) | R 10,800 |
| Phone | R 1,000 |
| Home office | R 3,000 |
| Prof dev | R 2,000 |
| **TOTAL** | **R 119,800/month** |

### KPIs for Bonus Calculation

**CTO:**
- Uptime SLA: 99.95% (5 nines) — full bonus if achieved
- Payment latency: <2 seconds p99 — 1% bonus per 0.1s below target
- Security incidents: 0 critical incidents — -5% bonus per incident
- Team satisfaction: NPS >70 — -2% bonus per 10 points below

**Backend Engineer:**
- Feature completion: On schedule per sprint — -2% per week overdue
- Code quality: <5 bugs per 1000 lines — -1% per additional bug
- Test coverage: >80% — -1% per 10% below target

**Compliance Officer:**
- Zero FSCA violations — full bonus if achieved
- SAR filing timeliness: 100% filed within 30 days — -5% per day late
- Merchant KYC approval rate: >90% first-time pass — -2% per % below
- Audit readiness: Pass annual audit — -10% if fail

---

## 5. Hiring Timeline & Cost

### Recruitment Process Timeline

**For each hire: 6-8 weeks**

1. **Week 1-2:** Job description, posting on LinkedIn/platforms
2. **Week 2-3:** Resume review, phone screening (5-10 candidates per role)
3. **Week 3-4:** Technical interviews (for engineers) or case studies (for non-tech)
4. **Week 4-5:** Offer negotiation
5. **Week 5-6:** Reference checks, background check (mandatory in ZA)
6. **Week 6-8:** Notice period (usually 2-4 weeks in ZA), onboarding

### Total Year 1 Recruitment Cost

| Activity | Cost |
|----------|------|
| LinkedIn Recruiter (6 hires × R 20k avg) | R 120,000 |
| Recruitment agency (3 difficult hires × 20% of salary × 12) | R 180,000 |
| Background checks (10 hires × R 1,500 each) | R 15,000 |
| Skills assessments (technical tests, compliance quiz) | R 5,000 |
| Onboarding materials + systems (Slack, GitHub, AWS accounts, etc.) | R 10,000 |
| **TOTAL** | **R 330,000** |

---

## 6. Employee Agreements & Legals

### South African Employment Law Basics

**Key Legal Requirements:**

1. **Signed employment contract** (required before work starts)
2. **Basic Conditions of Employment Act (BCEA)** — 40-hour work week, 21 days annual leave, 8 public holidays
3. **Employment Equity Act (EEA)** — Reporting requirement if >50 employees (track employment by race/gender)
4. **Labor Relations Act (LRA)** — Fair dismissal procedures
5. **Compensation for Occupational Injuries and Diseases Act (COID)** — Work injury insurance

### Employment Contract Template (Items to Include)

```
EMPLOYMENT AGREEMENT

1. PARTIES
   Employee: [NAME]
   Employer: ForgePay SA (Pty) Ltd
   Company ID: [CIPC NUMBER]

2. POSITION & DUTIES
   Position: [TITLE]
   Location: Cape Town / Johannesburg (hybrid: 3 days office, 2 days home)
   Reports to: [MANAGER NAME/TITLE]
   Key responsibilities: [BRIEF LIST]

3. REMUNERATION
   Salary: R [AMOUNT]/month (paid by 25th of month)
   Bonus: [10% annual, based on KPIs]
   Benefits: Medical aid, retirement (12%), phone (R 1,000), home office (R 2,000/month)
   Review cycle: Annual (June)

4. EQUITY
   Options: [NUMBER] shares (at R 0.01/share)
   Vesting: 4-year vest, 1-year cliff
   Exercise period: 10 years from grant date

5. CONFIDENTIALITY & IP
   All work product (code, documents, ideas) belongs to ForgePay
   NDA applies: Cannot disclose ForgePay business details to competitors
   Duration: During employment + 2 years after

6. NOTICE PERIOD
   Employee: 4 weeks written notice to resign
   Employer: 4 weeks to terminate (or pay in lieu)
   Cause termination: Immediate (for gross misconduct)

7. LEAVE ENTITLEMENTS
   Annual leave: 21 working days/year (BCEA requirement)
   Sick leave: 6 days/year
   Public holidays: 8 days (paid by employer)
   Maternity/Paternity: Per BCEA (4 months unpaid, with reinstatement guarantee)

8. COMPENSATION FOR OCCUPATIONAL INJURIES (COID)
   Employer registers employee with COID fund
   Work-related injuries covered by COID insurance (not employee or employer liability)

9. DISPUTE RESOLUTION
   Any disputes: Refer to CCMA (Commission for Conciliation, Mediation, Arbitration)
   Cost: Free for employees, employer pays if ordered

10. INTELLECTUAL PROPERTY
    All code, documents, designs created during employment belong to ForgePay
    Exception: Personal projects (on own time, not using company resources)

11. REMOTE WORK POLICY
    Hybrid: 3 days/week office, 2 days home (negotiable by role)
    Equipment: Company provides laptop + monitor (permanent loan)
    Internet: Company reimburses R 500/month for home internet
    Security: VPN required for all remote work

12. TERMINATION
    At-will employment with notice period above
    Fair dismissal requires: Verbal warning, written warning, then dismissal (for performance issues)
    Severance: 1 week per year of service (if terminated without cause)
    Final settlement: Within 7 days of termination (salary + leave pay + severance)

13. JURISDICTION
    Governed by South African law
    Disputes: Referred to CCMA (preferred) or South African courts

SIGNATURES:
Employee: _________________________ Date: _______
Employer: _________________________ Date: _______
(By: CEO/Director)
```

### Taxes on Employee Earnings (Deducted by Employer)

**Monthly deduction from employee salary:**

- **PAYE (Income Tax):** 18-45% progressive (depends on income bracket)
- **UIF (Unemployment Insurance Fund):** 1% (employer also contributes 1%)
- **Medical aid:** Employee's chosen percentage (typically 5-15% of salary)

**Example for R 105,000/month backend engineer:**

```
Gross Salary:            R 105,000
Less: PAYE (est. 25%)   (R 26,250)
Less: UIF (1%)          (R 1,050)
Less: Medical aid (8%)  (R 8,400)
NET SALARY:             R 69,300
```

**Employer costs on R 105,000 salary:**

```
Base salary:            R 105,000
Employer UIF (1%):      R 1,050
Employer medical (8%):  R 8,400
Employer retirement (12%): R 12,600
SDL (Skills Dev, 0.5% ÷ 10 employees): R 525
TOTAL COST:             R 127,575 (21.7% more than base salary)
```

---

## 7. Onboarding Checklist

### Day 1 (First Day)

- [ ] Office access (keys, parking pass, badge)
- [ ] Laptop + peripherals + phone (all pre-loaded)
- [ ] GitHub account + AWS account access configured
- [ ] Slack account created + added to channels
- [ ] VPN setup and tested
- [ ] Orientation meeting (1 hour with manager)
- [ ] Team introductions (30 min per team member)

### Week 1

- [ ] Company & culture overview (CEO, 1 hour)
- [ ] FSCA compliance training (Compliance Officer, 2 hours)
- [ ] Payment systems 101 (CTO, 2 hours)
- [ ] Codebase walkthrough (assigned buddy engineer, 4 hours)
- [ ] Security training (SARS requirements, password management, phishing)
- [ ] Database access + credentials (DevOps)
- [ ] First code commit pushed to GitHub

### Week 2-4

- [ ] Complete first task/feature (with code review)
- [ ] Attend daily standups + sprint ceremonies
- [ ] Monthly all-hands meeting (first month)
- [ ] 1-on-1 with manager (weekly)
- [ ] 30-day check-in (manager + employee feedback)

### Month 1 Check-in Questions

1. Do you have everything you need to do your job?
2. Are the team dynamics what you expected?
3. Is the compensation/benefits clear?
4. Any roadblocks or concerns?
5. When do you expect to be fully productive? (Most engineers: 1-2 months)

---

## 8. Performance Management & Reviews

### Quarterly Check-ins

**Every quarter (Mar, Jun, Sep, Dec), 15-min sync with manager:**

- On track with quarterly OKRs?
- Any skills gaps or training needed?
- Compensation questions?
- Career progression goals?

### Annual Review (June)

**Full performance review, 1 hour with manager + HR (if hired):**

1. **Self-assessment:** How did employee rate themselves?
2. **Manager assessment:** Performance against KPIs (see earlier section)
3. **360 review:** Feedback from peers (for senior roles)
4. **Compensation review:** Adjust salary based on performance + market rates
5. **Career conversation:** Where do they want to go in 2-3 years?

**Typical raises:**
- High performer: 8-12% raise + bonus increase
- Meets expectations: 5-7% raise
- Below expectations: 0% raise (or improvement plan)

### Promotion Track

**Individual Contributor Path (Engineers):**
- Junior (0-2 yrs): R 50-70k → Mid (2-4 yrs): R 80-120k → Senior (4+ yrs): R 120-180k → Staff Engineer (7+ yrs): R 200-300k+

**Managerial Path (for engineers who want to lead):**
- Engineering Manager (manages 3-5 engineers): +40% salary bump (R 105k → R 150k+)
- Director of Engineering (manages 2-3 managers): +50% salary bump (R 150k → R 225k+)

---

## 9. South African Labor Law Compliance

### Mandatory Compliance

**Registration with Department of Labor:**
- Register with UIF (Unemployment Insurance Fund) within 14 days of hiring
- Cost: Free
- Process: Online at UIF.org.za

**COID (Compensation for Occupational Injuries & Diseases):**
- Register employee with COID within 7 days of employment
- Cost: R 5-10 per employee (premium)
- Covers work-related injuries + illnesses

**PAYE Setup (Employer):**
- Register with SARS for PAYE (Pay As You Earn) tax
- Submit monthly tax returns (PAYE reconciliation)
- Deadline: 7th of following month

**SDL (Skills Development Levy):**
- 0.5% of payroll, submitted to SETA (Sector Education Training Authority)
- Deadline: 7th of following month
- Use for staff training budget (gets you tax credit)

### Prohibited Practices (Avoid These)

- ❌ Paying less than minimum wage (R 26.34/hour nationally as of 2024)
- ❌ Forcing employees to work >40 hours/week without overtime
- ❌ Discriminating by race, gender, disability, sexual orientation
- ❌ Unfair dismissal without following due process
- ❌ Cash-in-hand payments (no record = tax evasion)
- ❌ Forcing confidentiality on illegal activities

### Employee Rights (You must respect these)

1. **Right to fair labor practices** — Cannot be treated unfairly
2. **Right to organize** — Employees can join unions (TaxiRank, Solidarity, etc.)
3. **Right to strike** — If dispute with employer (with notice)
4. **Right to medical** — Must provide basic medical/wellness
5. **Right to safe work environment** — Must have OHSA (Occupational Health & Safety Act) compliance
6. **Right to leave** — 21 days annual + 8 public holidays minimum

---

## 10. Building Team Culture

### Company Values (Suggested for ForgePay)

1. **Payment Excellence** — Every transaction matters. Quality and reliability first.
2. **Regulatory Integrity** — We follow the rules, always. Compliance is non-negotiable.
3. **Merchant Success** — We succeed only if our merchants succeed.
4. **Ownership** — Everyone owns their work. Take pride in what you build.
5. **Transparency** — Open communication, honest feedback, no surprises.

### Weekly Rituals

- **Monday 9 AM:** All-hands standup (15 min) — What's this week's focus?
- **Wednesday Lunch:** Team lunch (rotating location, budget R 150/person)
- **Friday 4 PM:** Weekly wrap-up + beer (optional) — Celebrate wins, discuss challenges

### Quarterly Celebration

- **Month 3:** R 50M GMV milestone → Team dinner (R 5,000 budget)
- **Month 6:** 100 merchants → Team outing (R 10,000 budget)
- **Month 12:** R 500M cumulative GMV → Team trip or bonuses (R 50,000 budget)

---

## 11. Remote Work Policy

### Hybrid Model (Recommended)

- **3 days/week in office** (Monday, Wednesday, Thursday)
- **2 days/week work-from-home** (Tuesday, Friday)
- **Flexible for meetings** (can negotiate for your specific team)
- **Equipment:** Company provides laptop (MacBook Pro recommended) + monitor + chair

### Equipment Budget (Per Employee)

| Item | Cost | Notes |
|------|------|-------|
| Laptop (MacBook Pro or Lenovo ThinkPad) | R 25,000 | Loaned, returned at end of employment |
| Monitor (27", 4K) | R 8,000 | Loaned |
| Keyboard + Mouse | R 3,000 | Owned by employee (gift at end) |
| Laptop stand + dock | R 2,000 | Loaned |
| Headphones (noise-canceling) | R 3,000 | Loaned |
| External SSD (backup) | R 1,500 | Loaned |
| **TOTAL** | **R 42,500** | One-time per employee |

### Work-from-Home Stipend

- R 2,000/month for home office setup (desk, chair, lighting)
- R 500/month internet reimbursement (provide receipt)
- R 300/month phone line (if using personal phone for work)
- Total: R 2,800/month

### VPN & Security (WFH)

- All employees on VPN (Wireguard or equivalent)
- MFA (multi-factor auth) required for all systems
- No public WiFi for company work (must use home internet or mobile hotspot)
- Screen lock (5 min auto-lock) + encrypted disk

---

## 12. South Africa Hiring Checklist

### Pre-Offer

- [ ] Job description written + approved by CEO
- [ ] Budget approved (salary + benefits + equipment)
- [ ] Interview process defined (who interviews, what questions)
- [ ] Interviewer training (avoid illegal questions: family status, political affiliation, religion)

### Offer Stage

- [ ] Offer letter signed by CEO (includes salary, benefits, start date, equity)
- [ ] Background check authorized (background check company)
- [ ] Reference checks completed (past 2-3 employers)
- [ ] COID registration form started

### First Day

- [ ] Employment contract signed (keep original in file)
- [ ] UIF form U2 completed + submitted (within 14 days)
- [ ] COID form 5 completed + submitted (within 7 days)
- [ ] Medical aid enrollment completed
- [ ] Retirement fund enrollment completed

---

## Summary: Hiring Timeline & Team Growth

```
MONTH 1     MONTH 2     MONTH 3     MONTH 4     MONTH 5-6   MONTH 9-12
├─ CEO ─────┼─ CTO ─────┼ Dev #2 ───┼ Blockchain┼ QA + SRE2 ┼ More hires
├ Compliance├ Backend #1├ Frontend  ├ Success  ├ Finance   ├ 15+ people
├ BD Mgr    ├ DevOps    ├─────────┼ PM       ├ Compliance├
│           │           │          │          │ Analyst   │
├─────────────────────────────────┼─────────────────────────────┤
       MVP TEAM (6)                    SCALE TEAM (12-15)
```

**Total Year 1 Hiring Cost:** R 400,000-500,000 (recruiting + background checks + onboarding)

---

**Last Updated:** June 2026  
**Status:** Ready for Recruitment  
**Next: Execute hiring plan starting Month 1**
