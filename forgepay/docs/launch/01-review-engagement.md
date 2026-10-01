# Engaging an independent security-review firm

**This is a draft pack. Nothing has been sent to anyone.** Choosing a firm, sharing code, and signing are yours.

## What to buy (scope A: the bureau launch)

In scope: stablecoin-gateway (deposits, settlement, payouts, payout signer, sweeper, treasury, key wrapping, alerts, leader
lock), agent-credit-bureau billing and furnisher payouts, the console routes that call them, and the deployment manifests
(Helm/Terraform) for those. Out of scope for now (scope B, later): the threshold signer and custody governance, shielded
payments, other services. `docs/security-review/07-rfp.md` has the full RFP; `docs/security-review/10-remediation-status.md`
says what changed since it was written. **Refresh the package against a frozen commit/tag before sending** (see checklist).

## Choosing a firm

Ask for: named reviewers (not just a brand), two or three public reports of similar work (wallet/payments/custody, not only
smart contracts - the money path here is mostly TypeScript services and key handling), their method for re-testing fixes, fixed
price vs time-and-materials, earliest start, report format, and whether findings are disclosed to anyone besides you.
Red flags: a quote without reading the package, "automated scan" as the main deliverable, no retest included.
The RFP names example firms; check each one's current availability yourself.

## Before sending anything

1. Freeze a tag: `git tag review-scope-a-1 <commit>` (after the checklist below), and send that tag, not a branch.
2. Make the repository private-access for reviewers only; do not paste secrets: none are in the repo, confirm with a secret scan.
3. Sign an NDA first. The package describes known weaknesses honestly; it should not circulate.
4. Decide who is the single contact on your side, and who can approve fixes quickly.

## Checklist before the freeze

- [ ] All Fixed items in `10-remediation-status.md` re-verified on the tagged commit
- [ ] `docs/security-review/*` refreshed: commit hash, line citations, test counts (they cite `da11f54`)
- [ ] CI green on the tag (`.github/workflows/forgepay-custody-ci.yml`)
- [ ] The conservative launch configuration (`infra/helm/stablecoin-gateway/ci/launch-values.yaml`) is what reviewers are told is the target
- [ ] A staging environment reviewers can be pointed at (see `03-infrastructure-and-dust-test.md`)

## Draft email

> Subject: Security review request - payments gateway and credit-bureau billing (4-6 weeks, start <date>)
>
> Hello <name>,
>
> We are preparing the first production launch of a stablecoin payment gateway (deposits, payouts, treasury, key custody via
> cloud KMS) and the billing path of an agent credit bureau, handling USDC, ZARP and OUSD on Base. We would like an
> independent review of the code and deployment before real funds move.
>
> We have a review package (system overview, asset inventory, threat model, known limitations with the defects we already
> found, test evidence, and an RFP) that we will share under NDA. The reviewed scope is roughly <N> lines of TypeScript plus
> Helm/Terraform. Please tell us: your availability from <date>, named reviewers and relevant past reports, price and what it
> includes (retest of fixes, report format), and anything in the package you would want changed before you can quote.
>
> Regards,
> <name, role, contact>
