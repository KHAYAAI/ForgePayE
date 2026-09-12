# Mainnet deployment walkthrough — FORGE on Base

The expanded, command-by-command version of [`LAUNCH_RUNBOOK.md`](./LAUNCH_RUNBOOK.md)
Step 4 (contracts + admin handover) and the start of Step 5 (the payout
signer). Written for someone doing this once, solo, from a terminal.

Everything here is irreversible or costs real money. Read a phase fully
before running its commands. Do not skip the verification step between
Phase 1 and Phase 2 of the admin handover — it is the one step that
protects you from an unrecoverable mistake.

---

## Wallet inventory

Mainnet needs more distinct keys than testnet did. Get this list straight
before funding anything — mixing these up is the single easiest way to
waste real ETH or, worse, hand admin to the wrong address.

| Wallet | Role | Held by | Lifespan |
|---|---|---|---|
| **Signer A** (you, primary device) | Deployer + Safe co-signer #1 | You | Deployer role is revoked after Phase 2; Safe role is permanent |
| **Signer B** (your second device) | Safe co-signer #2 | You | Permanent |
| **Signer C** | Safe co-signer #3 | Your third person | Permanent |
| **Settlement bot wallet** | Holds `UPDATER_ROLE`/`RECORDER_ROLE`/etc. — the bureau service's own on-chain identity | Nobody signs with this by hand; the running `agent-credit-bureau` service holds the key | Permanent, operational |
| **Payout signer wallet** | The hot wallet that actually sends USDC to furnishers (Step 5) | The running `stablecoin-gateway` service | Permanent, operational, funded with real USDC |

Signer A doubles as both a Safe owner and the deployer — that's normal and
fine, since Phase 2 revokes the deployer role from it entirely, leaving only
its (equal, 1-of-3) vote in the Safe. The settlement bot and payout signer
wallets must be **freshly generated**, used for nothing else, same as you
did on testnet.

---

## Phase 0 — Generate the two service wallets

Exactly like testnet, but do this on your own machine and never paste the
private keys into chat:

```bash
cast wallet new   # settlement bot wallet
cast wallet new   # payout signer wallet
```

Write down both addresses. Keep both private keys somewhere you will put
into a secrets file shortly — not in your shell history, not in Slack.

---

## Phase 1 — Fund every wallet with real ETH

All on **Base mainnet** (chain ID 8453) this time — no faucets. Buy ETH on
an exchange and withdraw it to Base directly (most major exchanges support
Base withdrawals now), or bridge from Ethereum mainnet via
[bridge.base.org](https://bridge.base.org).

| Wallet | Suggested funding | Why |
|---|---|---|
| Signer A | 0.02–0.03 ETH | Pays for: Safe creation, contract deployment (5 contracts), Phase 1 grant, Phase 2 renounce |
| Signer B | 0.005 ETH | One test grant + one test revoke transaction from the Safe |
| Signer C | 0.005 ETH | Same, in case it ever needs to co-sign alone |
| Settlement bot wallet | 0 ETH for now | It never sends its own transactions — the bureau calls view functions and the deploy script grants it roles. Fund it with a small amount (~0.005 ETH) only if you later want it submitting transactions directly. |
| Payout signer wallet | Not yet | Fund this in Step 5, after contracts are live and administered by the Safe |

Verify each balance before moving on:

```bash
cast balance <address> --rpc-url https://mainnet.base.org
```

**Expect:** a non-zero wei value for Signer A, B, and C.

---

## Phase 2 — Create the Safe multisig

1. Go to **[app.safe.global](https://app.safe.global)**.
2. Connect Signer A's wallet. Select **Base** as the network.
3. Click **Create new Safe**.
4. Add all three addresses as owners: Signer A, Signer B, Signer C.
5. Set the threshold to **2 out of 3**.
6. Review and deploy. This costs a small amount of Signer A's ETH.
7. Once deployed, copy the Safe's own address — this is `ADMIN_MULTISIG_ADDRESS` for everything below.

Confirm it's real before trusting it:

```bash
cast code <safe_address> --rpc-url https://mainnet.base.org
```

**Expect:** a long hex string (bytecode), not `0x`. An empty result means
you copied an owner's address instead of the Safe's own address — a
mistake `VerifyAdmin.s.sol` and `TransferAdmin.s.sol` both refuse to
proceed past, but worth catching yourself first.

---

## Phase 3 — Set up your local secrets

Same pattern as testnet's `.env` file, new location, new values:

```bash
cd ~/forgepaye/forgepay/on-chain
cat > .env.mainnet << 'EOF'
SETTLEMENT_PRIVATE_KEY=<Signer A's private key>
SETTLEMENT_BOT_ADDRESS=<settlement bot wallet address — public, not the key>
CCIP_ROUTER_ADDRESS=0x881e3A65B4d4a04dD529061dd0071cf975F58bCD
ADMIN_MULTISIG_ADDRESS=<the Safe's address from Phase 2>
EOF
```

Verify it landed without ever printing the key:

```bash
wc -l .env.mainnet
grep -c "^SETTLEMENT_PRIVATE_KEY=0x" .env.mainnet
```

**Expect:** `4` and `1`.

Load it into your shell before each command below (do this once per
terminal session):

```bash
set -a && source .env.mainnet && set +a
```

---

## Phase 4 — Deploy the five contracts

```bash
cd ~/forgepaye/forgepay/on-chain
forge build

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://mainnet.base.org \
  --broadcast --verify
```

This is the first irreversible, real-money action in this walkthrough —
five contract creations plus ten role grant/revoke calls, broadcast for
real. Read the output carefully.

**Expect:** a `=== FORGE ON-CHAIN DEPLOYMENT SUMMARY ===` block listing five
addresses and `Chain ID: 8453`. **Record all five addresses immediately** —
copy them into `.env.mainnet`:

```bash
cat >> .env.mainnet << 'EOF'
FORGE_REGISTRY_ADDRESS=<from the output>
FORGE_VALIDATOR_ADDRESS=<from the output>
FORGE_ENFORCER_ADDRESS=<from the output>
FORGE_CORE_ADDRESS=<from the output>
FORGE_CROSSCHAIN_ADDRESS=<from the output>
EOF
set -a && source .env.mainnet && set +a
```

Sanity-check each one actually has code before trusting it further:

```bash
cast code $FORGE_REGISTRY_ADDRESS --rpc-url https://mainnet.base.org
```

**Expect:** non-empty bytecode, same as the Safe check above.

---

## Phase 5 — Admin handover, Phase 1 (grant)

```bash
forge script script/TransferAdmin.s.sol:TransferAdmin \
  --rpc-url https://mainnet.base.org --broadcast
```

**Expect:** `Phase 1 complete. DEFAULT_ADMIN_ROLE granted to: <safe address>`,
and `Deployer still holds admin: <signer A address>`.

Verify independently, not just from the script's own claim:

```bash
export DEPLOYER_ADDRESS=<signer A's address>
EXPECT_PHASE=1 forge script script/VerifyAdmin.s.sol:VerifyAdmin \
  --rpc-url https://mainnet.base.org
```

**Expect:** `STATE: Phase 1 complete. Multisig administers all 5; the
deployer still does too.`

---

## Phase 6 — Prove the Safe can actually sign

**Do not skip this.** This is the step the runbook calls out by name: if
the Safe cannot sign and you renounce the deployer's admin anyway,
`DEFAULT_ADMIN_ROLE` ends up with no holder and no recovery path, ever.

From the Safe UI (app.safe.global → your Safe → New Transaction →
Contract Interaction):

1. Pick any one of the five contracts (the registry is fine).
2. Call `grantRole` with `role = 0x0000...0000` (32 zero bytes —
   `DEFAULT_ADMIN_ROLE`) and `account = <Signer C's address>`, or any
   address you control, just to prove the call works.
3. Get Signer B (or C) to approve the transaction in the Safe UI, reaching
   the 2-of-3 threshold.
4. Confirm it executed: `cast call <registry_address> "hasRole(bytes32,address)(bool)" 0x0000000000000000000000000000000000000000000000000000000000000000 <the test address> --rpc-url https://mainnet.base.org` should return `true`.
5. Now revoke it the same way (`revokeRole`, same args), so you haven't
   left a stray admin lying around. Confirm `hasRole` now returns `false`.

Only proceed once both the grant and the revoke actually executed through
the Safe.

---

## Phase 7 — Admin handover, Phase 2 (renounce)

```bash
RENOUNCE_DEPLOYER=true forge script script/TransferAdmin.s.sol:TransferAdmin \
  --rpc-url https://mainnet.base.org --broadcast
```

The script itself refuses to run this if the Safe doesn't already hold
admin on all five contracts — but that check exists to catch a
`.env` typo, not to replace Phase 6's real proof.

Verify:

```bash
EXPECT_PHASE=2 forge script script/VerifyAdmin.s.sol:VerifyAdmin \
  --rpc-url https://mainnet.base.org
```

**Expect:** `STATE: Phase 2 complete. The multisig is the sole
administrator. F-06 is closed.`

From this point, Signer A's key administers nothing. Only the Safe does.

---

## Phase 8 — Point the bureau at mainnet

In `docker-compose.dev.yml` (or wherever your production deployment
configures `agent-credit-bureau`), replace the Base Sepolia block with:

```yaml
NODE_ENV: production
CHAIN_RPC_URL: https://mainnet.base.org
CHAIN_ID: "8453"
FORGE_REGISTRY_ADDRESS: "<from Phase 4>"
FORGE_VALIDATOR_ADDRESS: "<from Phase 4>"
FORGE_ENFORCER_ADDRESS: "<from Phase 4>"
FORGE_CORE_ADDRESS: "<from Phase 4>"
FORGE_CROSSCHAIN_ADDRESS: "<from Phase 4>"
SETTLEMENT_PRIVATE_KEY: <the settlement bot wallet's private key, from Phase 0>
```

`CHAIN_ID` must be set explicitly — it defaults to 84532 (Base Sepolia),
and `assertChainConfigured()` refuses to boot in production without an
explicit value that agrees with the RPC. That refusal is protecting you
from silently settling real customer scores to a testnet.

Before restarting the service with this config, run the read-only
preflight — it costs nothing and catches exactly this class of mistake:

```bash
docker compose exec agent-credit-bureau npm run preflight
```

**Expect:** `Preflight passed against Base (chainId 8453).` — no testnet
caveat this time.

---

## What's next (Step 5, not covered here)

Turning on the mainnet payout signer is its own irreversible step with its
own funding decisions — covered in `LAUNCH_RUNBOOK.md` Step 5. Do it only
after Phase 8 has run cleanly and you've watched Mode 2 scores actually
settle on Base mainnet for a few real agents.
