# First contact with real ZARP and OUSD on Base

Everything about ZARP and OUSD so far has been tested against a mock token on a local chain. The
first time the gateway reaches Base it meets contracts nobody here has read. This is what the code
checks automatically, what it cannot check, and what a person does before real money moves.

Addresses on file (supplied by the operator, **not verified by us** — egress from the build
environment is blocked, so none of this has touched the real contracts):

| Asset | Base address |
|---|---|
| OUSD | `0xB2000000000000000000002fEb517dFeC7415344` |
| ZARP | `0xb755506531786C8aC63B756BaB1ac387bACB0C04` |

**Open question:** is OUSD a rebasing token? It was asked and not answered. Treat the answer as
unknown until someone reads the contract.

## What the gateway checks by itself (on every start and every `ASSET_VERIFY_INTERVAL_MS`)

`GET /assets` shows each result under `findings`. Nothing here sends a transaction.

| Check | Result |
|---|---|
| RPC reports Base (chain id 8453) | else the asset is **unavailable** |
| A contract exists at the address | else **unavailable** |
| `symbol()` matches (OUSD / ZARP) | else **unavailable** |
| `decimals()` is sane and equals the configured/pinned value | else **unavailable** |
| `paused()` returns true | **unavailable** until it returns false |
| Rebasing signs: answers `sharesOf`, `totalShares`, `rebasingCreditsPerToken`, `creditsBalanceOf`, `scaledBalanceOf`, `gonsPerFragment`… | **unavailable**; override only with `ASSET_ALLOW_REBASING_<SYMBOL>=true` after reading this page |
| EIP-1967 proxy | **review** finding with the implementation and admin addresses. If the implementation **changes** between checks, a critical alert fires |
| Can freeze addresses (`isBlacklisted`, `isFrozen`…) | **review** |
| Fee-like settings (`transferFeeBasisPoints`, `taxFee`…) | **review** |
| Pausable / has an owner | info |

Then, per deposit, before crediting: the gateway reads `balanceOf(depositAddress)` and **refuses to
credit** if the address holds less than the quoted amount, raising a critical alert. This is the
check that catches what the probes cannot — a fee-on-transfer token, a rebase, a token whose
`Transfer` event overstates what moved — because it measures what actually arrived.

**What these cannot prove:** that a token is safe. A probe is "did the contract answer", so a
rebasing or fee-taking token with unusual function names passes it. They narrow the risk and make
changes loud; they do not replace reading the contract.

## What a person does before launch

1. **Read both contracts on Basescan** (or the source repos): proxy? who is admin/owner? can the
   issuer pause, freeze, mint without limit, or change the implementation? Is OUSD rebasing? Write
   down the answers and the date, with the implementation address.
2. **Confirm the addresses with the issuers** (Zarp's and Open Standard's own published docs), not
   only with the person who pasted them here.
3. **Run the gateway against Base read-only** (no signer, `SWEEP_ENABLED` off) and open
   `GET /assets`: both should be `available`, `decimals` matching what the issuers' own docs state (the gateway pins and
   cross-checks decimals; do not take a number from memory), and read every `findings` entry.
4. **Check the rate feed:** `GET /assets/rates/feed/check` from the deployed gateway. The sources
   are the providers' documented public APIs and have not been called from our build environment.
5. **Dust test with real money, in this order, one asset at a time:**
   - open a deposit for a small amount, pay it from a wallet you control, and watch it go
     `pending → confirming → confirmed`; compare the credited units to the on-chain `balanceOf`;
   - sweep it to the treasury and compare what arrived to what was swept (a fee shows up here);
   - send a small payout and check the recipient received exactly the amount;
   - repeat after waiting a day, and compare balances again (a rebase shows up here).
6. **Only then** raise limits. Keep `PAYOUT_AUTO_SUBMIT=false` (operator submits each payout) until the
   dust tests and the independent review are done.

## If something is wrong

- An asset flips to `unavailable`: new deposits and payouts in it stop; others carry on. That is the
  design. Fix the cause or remove the asset from the configuration.
- `deposit:balance:…` critical alert: a deposit's events and balance disagree. Do not override.
  Look at the transaction; stop the asset if it repeats.
- `asset:upgraded:…` critical alert: the issuer upgraded the contract. Read what changed before
  accepting more of it.
