# Incident Response Policy

**Document ID:** ISP-003
**Version:** 1.0
**Classification:** Confidential — Internal Use Only
**Effective Date:** [DATE OF EXECUTIVE APPROVAL]
**Next Review Date:** [EFFECTIVE DATE + 12 MONTHS]
**PCI DSS Reference:** Requirements 12.10.1–12.10.7

---

## 1. Purpose

This Incident Response Policy defines ForgePay's approach to detecting, responding to, and recovering from security incidents — with specific provisions for incidents involving cardholder data (CHD). The goal is to minimize the impact of security incidents, preserve evidence, restore normal operations quickly, and meet all notification obligations to card brands, regulators, and affected parties.

**For a confirmed or suspected breach of cardholder data, ForgePay must notify Visa and Mastercard within 72 hours.** This deadline is absolute. This policy is designed to ensure that timeframe is met.

---

## 2. Scope

This Policy applies to all security incidents affecting:
- ForgePay systems, data, networks, and personnel
- Cardholder data environment (CDE) components as defined in `01_scope_definition.md`
- CHD and SAD in any state (at rest, in transit, in processing)
- ForgePay's vendors and service providers when incidents affect ForgePay data

---

## 3. Definitions

| Term | Definition |
|------|-----------|
| **Security Incident** | Any actual or suspected unauthorized access, use, disclosure, modification, or destruction of ForgePay information assets; any violation of this Policy or applicable law; any event that compromises the confidentiality, integrity, or availability of systems or data |
| **Potential Breach** | A security incident that may have resulted in unauthorized access to CHD or SAD; requires immediate escalation |
| **Confirmed Breach** | A security incident where forensic or log evidence confirms unauthorized access to, acquisition of, or disclosure of CHD or SAD |
| **Compromise Indicator** | Any technical evidence suggesting a system may have been compromised (e.g., unexpected process, outbound connection, file modification, unauthorized account activity) |
| **First Responder** | The initial security engineer or on-call SRE who receives and triages the incident alert |
| **Incident Commander** | The person (typically CISO or senior security engineer) responsible for coordinating the overall incident response |
| **Forensic Evidence** | Data, logs, system images, network captures, and other artifacts that document the nature and scope of a security incident |

---

## 4. Incident Response Team

### 4.1 Core Team

| Role | Responsibility | Contact |
|------|---------------|---------|
| Incident Commander | Coordinates all response activities; communicates with executive leadership; makes containment decisions | CISO — [PHONE] |
| Security Lead | Technical investigation; forensic analysis; containment implementation | Head of Security — [PHONE] |
| On-Call SRE / DevSecOps | System access; infrastructure isolation; deployment of containment controls | On-call rotation — [PAGERDUTY LINK] |
| Legal Counsel | Assesses notification obligations; manages privilege; advises on law enforcement engagement | [LEGAL CONTACT] |
| Communications Lead | Internal communications; external statements; merchant notifications | Head of Comms — [PHONE] |
| Executive Sponsor | Decision-making authority for major business decisions (e.g., system shutdown, law enforcement engagement) | CEO / CTO — [PHONE] |

### 4.2 24/7 Contact and Escalation

**Primary incident report:** security@forgepay.com | Incident hotline: [PHONE NUMBER]

**Escalation chain (all incidents involving suspected CHD exposure):**
1. Alert received by on-call (PagerDuty) → Incident Commander notified within 15 minutes
2. Incident Commander notifies CISO within 30 minutes of suspicion of CHD exposure
3. CISO notifies CEO and Legal within 1 hour of potential CHD breach determination
4. Legal counsel retained within 2 hours for confirmed/suspected CHD breaches

### 4.3 External Contacts

| Organization | Contact | When to Contact |
|-------------|---------|----------------|
| Visa CIRT | 1-650-432-2978 | Within 72 hours of confirmed CHD breach |
| Mastercard SDP | 1-636-722-4100 | Within 72 hours of confirmed CHD breach |
| AWS Security | https://aws.amazon.com/security/vulnerability-reporting/ | If breach involves AWS infrastructure |
| FBI Cyber Division | [LOCAL FIELD OFFICE] | If criminal activity suspected; consult Legal first |
| PCI Forensic Investigator (PFI) | [CONTRACTED PFI FIRM] | Card brand may require engagement for major breaches |
| Cyber insurance carrier | [CARRIER + CLAIM NUMBER PROCESS] | Notify per policy terms; typically within 24-72 hours |

**Note:** Retaining a PCI Forensic Investigator (PFI) before a breach is highly recommended. Identify and contract a PFI firm in advance. The card brands may mandate a specific PFI for major breaches. A pre-arranged PFI retainer typically reduces incident response time by days.

---

## 5. Incident Classification

| Severity | Description | Examples | Response SLA |
|----------|-------------|---------|-------------|
| **P1 — Critical** | Confirmed or suspected CHD/SAD breach; active attack on CDE; complete system compromise | Unauthorized access to payment-engine or pci-vault; data exfiltration detected; active malware in CDE | Incident Commander: 15 min; Containment plan: 1 hour |
| **P2 — High** | Significant security event with potential CHD impact; unauthorized CDE access attempts | Brute force against admin accounts; privilege escalation in CDE namespace; unusual data access patterns | Incident Commander: 30 min; Containment plan: 2 hours |
| **P3 — Medium** | Security event with limited impact; no immediate CHD exposure | Malware on non-CDE system; phishing email clicked (credentials not entered); failed pen test detection | Security Lead: 2 hours; Containment plan: 8 hours |
| **P4 — Low** | Security policy violation; suspicious activity; informational | Unapproved software installed; policy violation by employee; failed scan | DevSecOps: 1 business day |

---

## 6. Incident Response Phases

### Phase 1: Detect and Report

**Goal:** Identify and report security events promptly

**Detection sources:**
- SIEM / CloudWatch alerts (automated)
- Falco / GuardDuty alerts (automated)
- AWS WAF alert (automated)
- IDS/IPS alert (automated)
- Employee report (human)
- Merchant complaint (external)
- Third-party notification (external)
- Vulnerability scanner finding

**Reporting:**
- All personnel must report suspected security incidents immediately to security@forgepay.com or the incident hotline
- All automated alerts route to PagerDuty → on-call DevSecOps
- On-call assesses the alert and creates an incident ticket within 15 minutes
- P1/P2 incidents trigger immediate escalation to Incident Commander

**First Responder Checklist:**
- [ ] Log the alert or report with timestamp, source, and initial description
- [ ] Create incident ticket in tracking system
- [ ] Classify severity (P1–P4)
- [ ] Notify Incident Commander for P1/P2
- [ ] Do NOT access, delete, or modify potentially compromised systems until authorized

---

### Phase 2: Contain

**Goal:** Limit further damage; prevent additional CHD exposure

**Containment decisions are made by the Incident Commander. Do not act unilaterally on CDE systems.**

**Containment strategies by incident type:**

| Incident Type | Containment Actions |
|---------------|-------------------|
| Active intrusion in CDE | Isolate compromised pod/node (cordon node, delete pod); apply emergency NetworkPolicy to block lateral movement; revoke compromised credentials immediately |
| Compromised service account or credentials | Revoke credentials immediately; rotate all secrets that may have been exposed; audit access logs for misuse |
| Malware detected in CDE | Isolate affected node from cluster; capture memory image before restart; preserve disk image; replace node from clean AMI |
| Data exfiltration detected | Block outbound connection at network firewall level; capture network logs; preserve CloudTrail logs |
| Unauthorized access to admin console | Revoke all sessions; rotate admin credentials; enable emergency access controls |

**Containment Evidence Preservation (Critical):**
Before any containment action that may destroy evidence:
1. Take memory dump of affected pods/nodes (if technically feasible)
2. Capture full network packet capture from affected period (AWS VPC Traffic Mirroring if pre-configured)
3. Export all relevant logs to separate, preserved location
4. Create snapshot of affected EBS volumes
5. Document all containment actions with timestamps in incident ticket

**Containment Checklist — P1 Incident:**
- [ ] Incident Commander engaged
- [ ] Compromised credentials revoked
- [ ] Affected systems isolated from network (Kubernetes NetworkPolicy emergency rule or AWS security group change)
- [ ] Evidence preservation steps completed
- [ ] Payment processing continuity assessed (can processing continue on clean systems?)
- [ ] Legal counsel notified
- [ ] Cyber insurance carrier notified
- [ ] Card brand notification timeline tracking started (72-hour clock)

---

### Phase 3: Eradicate

**Goal:** Remove the threat and confirm systems are clean

1. Identify the root cause of the incident (how did the attacker get in? what did they access? what did they change?)
2. Remove malware, unauthorized accounts, backdoors, and attacker persistence mechanisms
3. Patch the exploited vulnerability or misconfiguration
4. Rotate all credentials that may have been compromised
5. Rebuild affected systems from clean, known-good state (preferred over cleaning)
6. Validate eradication with the PFI or internal security team

**For CDE systems, eradication must be validated by the Incident Commander before proceeding to recovery.**

---

### Phase 4: Recover

**Goal:** Restore services safely; confirm no residual threat

1. Bring systems back online in a staged manner, starting with non-CDE systems
2. Enhanced monitoring in place before re-enabling CDE processing
3. Conduct smoke testing of payment processing in staging environment
4. Re-enable CDE processing with enhanced monitoring
5. Monitor for 24–48 hours for any signs of residual threat
6. Confirm all security controls are fully operational
7. Notify relevant parties that recovery is complete

---

### Phase 5: Post-Incident Review

**Goal:** Learn from the incident; prevent recurrence; complete documentation

The post-incident review must be completed within 5 business days of incident closure. Review must include:

1. Timeline reconstruction (when did each event occur?)
2. Root cause analysis (what allowed this to happen?)
3. Response effectiveness review (what worked? what didn't?)
4. Identification of detection gaps (how could we have detected this sooner?)
5. Recommended preventive actions with owners and deadlines
6. Lessons learned documented and distributed to relevant teams
7. Security policies or configurations updated as needed
8. Incident report finalized (see Section 8 for report requirements)

---

## 7. Cardholder Data Breach — Special Requirements

When a breach of CHD or SAD is confirmed or reasonably suspected, the following requirements apply in addition to the standard incident response phases.

### 7.1 Notification Timeline

| Milestone | Action | Deadline |
|-----------|--------|---------|
| Breach suspected | Internal escalation; Legal notified; 72-hour clock starts | Immediately |
| Breach confirmed | Notify Visa CIRT and Mastercard SDP | Within 72 hours of confirmation |
| Breach confirmed | Notify cyber insurance carrier | Per policy terms (typically within 24–72 hours) |
| Breach confirmed | Preserve all evidence per PFI requirements | Immediately |
| PFI engagement | PFI engagement if required by card brands | Per card brand directive |
| Affected individuals | Notify affected cardholders per applicable law | Per applicable law (e.g., POPIA: without undue delay; GDPR: 72 hours to regulator) |

**Critical:** The 72-hour notification requirement to Visa and Mastercard runs from the point of **confirmation** (not discovery). Do not delay forensic investigation to determine whether CHD was actually accessed. If there is reasonable suspicion of CHD exposure, notify Legal immediately and begin the notification preparation process.

### 7.2 Visa Notification Requirements

Visa Cardholder Information Security Program (CISP):
- Notify Visa CIRT: 1-650-432-2978 (24/7)
- Provide: entity name, contact information, date of discovery, estimated number of accounts affected, compromised systems, card brands affected
- Visa may require engagement of a specific PFI

### 7.3 Mastercard Notification Requirements

Mastercard Security Programs team:
- Notify: 1-636-722-4100 or compromised@mastercard.com
- Same information required as Visa

### 7.4 PCI Forensic Investigator (PFI) Engagement

For incidents involving confirmed or reasonably suspected CHD breach:
- Card brands may mandate PFI engagement
- ForgePay must cooperate fully with the PFI
- All evidence must be preserved and made available to the PFI
- ForgePay's legal counsel should be present during PFI interviews
- PFI report goes to the requesting card brand and the acquiring bank

### 7.5 Evidence Preservation for PFI

**Do not destroy or alter any evidence.** The PFI needs:
- All system logs covering the period of the suspected breach (minimum 90 days prior)
- Memory images of affected systems (if captured)
- Disk images of affected systems
- Network flow logs (VPC Flow Logs) for the affected period
- All access logs for the CDE for 90 days prior
- List of all accounts with access to CDE during the incident period
- Change management records for 90 days prior

**Evidence retention for security incidents: minimum 3 years.**

---

## 8. Incident Documentation Requirements

Every security incident (P1–P4) must be documented. The incident record must include:

| Field | Content |
|-------|---------|
| Incident ID | Unique tracking number |
| Classification | P1/P2/P3/P4 |
| Date/time discovered | With timezone |
| Date/time reported | With timezone |
| Date/time contained | With timezone |
| Date/time resolved | With timezone |
| Incident description | Detailed narrative |
| Affected systems | Specific systems, pods, instances |
| CHD involved? | Yes/No; if Yes, estimated scope |
| Root cause | Identified root cause |
| Containment actions | Timestamped actions taken |
| Eradication actions | Timestamped actions taken |
| External notifications | Who was notified; when |
| Lessons learned | Specific improvements identified |
| Follow-up actions | With owners and deadlines |

Incident records are maintained in the incident tracking system and retained for a minimum of 3 years.

---

## 9. Testing the Incident Response Plan

The IR plan must be tested at least annually per PCI DSS Req 12.10.2. Testing formats include:

| Test Type | Frequency | Description |
|-----------|-----------|-------------|
| Tabletop exercise | Annually (minimum) | Walkthrough of a simulated incident scenario; identify gaps |
| Simulation exercise | Annually | More realistic simulation with actual system interaction |
| Red team exercise | Every 2 years | Full adversarial simulation; optionally combined with pen test |

Test results must be documented, reviewed by the Incident Commander, and used to update this policy.

---

## 10. Training Requirements

All members of the Incident Response Team must:
- Complete IR training within 30 days of assignment
- Participate in annual tabletop exercise
- Review this policy annually

All ForgePay personnel must:
- Know how to report a security incident (security@forgepay.com or incident hotline)
- Complete security awareness training annually (includes incident reporting)

---

## 11. Related Documents

- Information Security Policy (ISP-001)
- Access Control Policy (ISP-002)
- Business Continuity Plan
- Disaster Recovery Plan
- PCI DSS Scope Definition (`01_scope_definition.md`)

---

## 12. Policy Review

This Policy is reviewed annually and immediately after any security incident that reveals a gap in the policy.

---

## Executive Approval

| Name | Title | Signature | Date |
|------|-------|-----------|------|
| | Chief Executive Officer | | |
| | Chief Information Security Officer | | |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-25 | CISO | Initial version |

---

*Document Owner: CISO*
*Classification: Confidential — Internal Use Only*
*Distribution: Incident Response Team; All Management; Security Awareness Training*
