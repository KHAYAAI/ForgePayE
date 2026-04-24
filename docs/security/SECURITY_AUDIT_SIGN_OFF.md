# Security Audit Sign-Off

**Status: PENDING — Awaiting external audit completion**

This file must contain `SIGNED_OFF: YES` before mainnet deployment is permitted.
The `deploy-mainnet.ts` script and GitHub Actions `contract-deploy.yml` workflow
both check for this marker.

---

## Instructions for Signing Off

Once all BLOCKING items in `shielded-payments-audit-checklist.md` are resolved
and both external firms have confirmed:

1. Update `SIGNED_OFF: <status>` below to `SIGNED_OFF: YES`
2. Fill in the audit report references
3. Commit this file to `claude/forgepay-platform-design-gEkgE`
4. The mainnet deployment workflow will then proceed

---

## Sign-Off Status

```
SIGNED_OFF: NO
```

## ZK Firm Sign-Off

- **Firm:** [TBD — Trail of Bits / Least Authority / other]
- **Report date:** [PENDING]
- **Report reference:** [PENDING]
- **Lead auditor:** [PENDING]
- **BLOCKING findings resolved:** [PENDING]

## Solidity Firm Sign-Off

- **Firm:** [TBD — OpenZeppelin / Consensys Diligence / Spearbit]
- **Report date:** [PENDING]
- **Report reference:** [PENDING]
- **Lead auditor:** [PENDING]
- **BLOCKING findings resolved:** [PENDING]

## Internal Sign-Off

- **Engineering lead:** [PENDING]
- **Security lead:** [PENDING]
- **CTO:** [PENDING]
- **Date:** [PENDING]

## Proving Key Attestation

- **SHA-256 of proving key:** [PENDING]
- **Trusted setup ceremony:** [PENDING]
- **Public URL:** [PENDING]

---

*Do not modify this file except to update the sign-off fields above.*
*Unauthorized modification of SIGNED_OFF: YES is a serious security incident.*
