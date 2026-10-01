# Brief for counsel

**A draft for you to edit and send. I am not a lawyer; this states facts about the product and asks questions. Nothing here is
legal advice and no conclusion in it should be relied on.** Engage counsel with crypto-asset, payments and data-protection
experience in the jurisdictions below; ask for the answers in writing.

## What the business does (facts as built)

- **Agent credit bureau.** Scores autonomous software agents (not people) from payment and behaviour data supplied by
  "furnishers" (data contributors). Customers (lenders, counterparties) pay for reports/verifications. Price indicated: USD 4,000
  per month (plus metered pulls; confirm current pricing).
- **Payments.** Customers pay the bureau in stablecoins (USDC, ZARP, OUSD on Base) to one-time deposit addresses the gateway
  creates. Funds are swept to a company-controlled treasury wallet. A rand rate converts USD to ZARP amounts.
- **Furnisher payouts.** The bureau owes furnishers a revenue share, calculated per period and paid out in stablecoins from
  company funds to an address each furnisher nominates. Payouts need human approval in the first launch.
- **Not launched, but built:** a multi-tenant custody product (threshold-key wallets for third parties) and a merchant payment
  gateway. These will stay off in the first launch.
- Entity, directors and where operations/customers/furnishers are located: <fill in>.

## Questions (in priority order)

1. **Is receiving stablecoins as payment for our own service, and paying furnishers from our own funds, a regulated activity
   for us?** Under South Africa's crypto-asset regime (FSCA's declaration of crypto assets as financial products; any licensing
   of crypto-asset service providers) and under payments-licensing rules, does this fit inside an exemption, or do we need a
   licence or authorisation? Same question for the other jurisdictions our customers/furnishers are in.
2. **Do accrued furnisher entitlements amount to holding value on others' behalf?** What payout frequency, structure, and terms
   keep us on the right side (e.g. paying each period, no balances a furnisher can leave with us)? Do we need furnisher
   agreements that say so?
3. **Anti-money-laundering and sanctions obligations.** Are we an accountable institution (FIC Act) for any of this? Travel-rule
   obligations for stablecoin transfers? What KYC/KYB must we do on customers and furnishers, and what do we need to retain?
   (A sanctions screen exists in the bureau; what is the required standard?)
4. **Exchange control.** Rand-denominated pricing, ZARP, and cross-border payments from/to non-residents: what approvals or
   reporting apply (SARB/Authorised Dealer)?
5. **The product's scope under credit and privacy law.** Does scoring agents, not people, keep us outside the National Credit
   Act's bureau registration? Where an agent's operator or director is a natural person, or a person files a dispute, which
   data-protection obligations (POPIA and equivalents) apply, and what must our notices, consent and retention look like? May we
   call the product a "credit bureau"?
6. **Tax.** VAT/other treatment of crypto receipts and payouts; where to book revenue received in a stablecoin.
7. **Terms and liability.** What customer, furnisher and data-processing terms do we need, and what disclaimers about the scores?

## What we can show you

`docs/LAUNCH_SCOPE.md`, `docs/launch/04-conservative-launch.md` (the controls we intend to launch with), the pricing documents,
and the data model for what the bureau stores about agents and furnishers.

## Please tell us

Whether anything must happen before we take the first rand/dollar of revenue, what we must not do until it has, and what the
cheapest compliant structure for a first launch is.
