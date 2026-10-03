# Launching the credit bureau: step by step

**Scope:** the bureau, paying and being paid in **USDC only** (ZARP and OUSD are on hold), on Base. Custody, merchants and everything
else stay off. **Nothing below has been done yet.** Each step says who does it. Do not skip the gates; do not re-order the
money steps. Documents named here are in `forgepay/docs/launch/` unless a path says otherwise.

Time is not given because most of it is other people's: the review firm and counsel set the pace. Start those first, in parallel.

## Phase 0: start the slow things today (you; in parallel with everything)

1. **Engage counsel.** Send `02-counsel-brief.md` (fill in the entity and locations). Ask for written answers to the seven questions
   and for what must be true before the first rand or dollar of revenue.
2. **Engage the review firm** for scope A (gateway, treasury, payout signer, bureau billing). Follow `01-review-engagement.md`: NDA first,
   freeze a tag, then send `docs/security-review/`. Findings must be fixed and re-checked before launch; budget for that.
3. **ZARP and OUSD stay on hold** (done in code). Nothing to do, and nothing to confirm with their issuers until you want them.

## Phase 1: prepare what only you can (a few days)

4. **Accounts and services:** an AWS account for production (a separate one for staging is better); a domain and TLS certificate; PagerDuty
   and/or a Slack webhook; a Base RPC provider (a paid plan; keep the key out of the URL in config, in a secret).
5. **Wallets, generated offline** (hardware wallet or an air-gapped machine). You need four, and they must be four different keys:
   - **payout wallet** (hot: holds the float, signs payouts)
   - **sweep gas wallet** (hot: a little ETH; pays gas for sweeps)
   - **operating wallet** (receives swept deposits; tops up the payout wallet within caps)
   - **cold address** (the *address* only; the gateway never holds its key)
   Never paste a private key into chat, a ticket or a repository. The gateway reads keys from mounted secret files.
6. **Secrets in the secret store** (AWS Secrets Manager or Vault), not in the Helm values: database password, `INTERNAL_WEBHOOK_SECRET`,
   `VALID_API_KEYS` (>= 32 chars each: `openssl rand -hex 32`), the three hot-wallet key files, alert credentials, and for the compliance
   monitor: `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, and the bureau's service key (below).
7. **Compliance monitor credentials:** `KEY=$(openssl rand -hex 32)`. Put `KEY` in the bureau's secret as `COMPLIANCE_MONITOR_API_KEY`; put
   `$(printf '%s' "$KEY" | sha256sum | cut -d' ' -f1):bureau` in the monitor's `SERVICE_API_KEY_HASHES`. (Added in this round: without it
   the monitor had no way to accept the bureau's key in production and the bureau, which fails closed, could not screen anything.)

## Phase 2: stand up staging (needs Phase 1)

8. **Terraform** (`infra/terraform/examples/threshold-custody`, modules `kms-keys`, `secrets`, `alerts`): `plan` first, read it, then apply to
   **staging** only. Nothing here has ever been applied; expect to fix things.
9. **Deploy, in this order:** Postgres (managed, backups on) -> compliance monitor (it needs its own database, Redis, and must load the OFAC
   list: check `GET /health` / its logs; **screening now answers "error" until the list is loaded and under 72h old**) -> stablecoin gateway
   with `infra/helm/stablecoin-gateway/ci/launch-values.yaml` (fill the placeholders; one replica) -> bureau (`BUREAU_ENABLED_ASSETS=USDC`;
   `STABLECOIN_GATEWAY_URL`, `COMPLIANCE_MONITOR_URL`, keys). Images: the `forgepay-bureau-images` workflow builds and scans them; deploy by
   digest from its summary. It has never run: the first run is its test.
10. **Run the checks that have only ever run against fakes:**
    - KMS: `KEY_WRAP_PROVIDER=awskms KEY_WRAP_KMS_KEY_ID=<arn> AWS_REGION=<r> npx tsx scripts/verify-key-custody.ts` (in the gateway). Fix everything it reports.
    - Sanctions: screen a known OFAC-listed address through the bureau path and confirm it is **refused**; then stop the monitor and confirm
      the bureau **refuses** (fails closed) rather than proceeding.
    - Alerts: `POST /alerts/test`. A human must receive it within 5 minutes; record who and when.
    - Database: `scripts/db-restore-drill.sh` against a restore of a real backup, then `POST /reconcile/run`.
11. **Game day** (`05-operations-runbook.md`, section 5): do every item once in staging. Fix what it finds.

## Phase 3: testnet (Base Sepolia), needs Phase 2

12. Get test funds: Base Sepolia ETH from a public faucet, and test USDC from Circle's faucet. **Verify the test USDC contract address on
    Circle's own documentation** (I recall `0x036CbD53842c5426634e7929541eC2318f3dCF7e`; do not take that from me unchecked).
13. Generate throwaway wallets for payer, payout and gas (separate from production wallets). Fund them (payer: USDC + ETH; payout: a few USDC + ETH; gas: ETH).
14. Run, from a machine with RPC access (this needs Postgres reachable; `PGHOST/PGUSER/PGPASSWORD`):
    ```
    cd forgepay/services/stablecoin-gateway
    SMOKE_RPC_URL=https://sepolia.base.org SMOKE_CHAIN_ID=84532 SMOKE_USDC=<verified test USDC> \
    SMOKE_PAYER_KEY_FILE=~/.smoke/payer.key SMOKE_SIGNER_KEY_FILE=~/.smoke/payout.key SMOKE_GAS_KEY_FILE=~/.smoke/gas.key \
    SMOKE_TREASURY=<an address you control> node scripts/chain-smoke.cjs
    ```
    It passes 19/19 against a local chain with a mock token. It checks the token, a deposit (exact amount), the sweep (treasury gets exactly
    that), a human-approved payout (recipient gets exactly that), and reconciliation. **All must PASS.** Read every `findings` line it prints.
15. Run it **twice**, a day apart, and compare balances in between (a token that changes balances on its own would show here).
16. Point **staging** (not the smoke script) at Base Sepolia and repeat the dust procedure (`03-infrastructure-and-dust-test.md`) through the
    real deployment: the staging config is what production will be.

## Phase 4: go / no-go (all must be true)

17. [ ] Review firm's findings fixed and re-checked; written sign-off, or a written list of accepted risks you have read
18. [ ] Counsel's written answers received, and anything they require is done (licence, terms, notices)
19. [ ] Phases 2 and 3 complete with no unexplained difference in any balance
20. [ ] Sanctions screening proven to refuse a listed address and to fail closed with the monitor down, in the production-shaped deployment
21. [ ] On-call named, alerts tested this week, runbook game day done, reconciliation owner named
22. [ ] Rollback understood: set `payout.signerEnabled=false` (stops outflows in minutes); deposits can keep being received
23. [ ] Limits are the conservative ones (`04-conservative-launch.md`) and nobody has raised them

## Phase 5: mainnet

24. **Production environment**: apply Terraform to production, deploy as in step 9 with production secrets and wallets. Do the step-10 checks again
    against production (KMS, alerts, sanctions, restore).
25. **Fund minimally:** the payout wallet with a few dollars of USDC plus gas; the gas wallet with a little ETH. Not more.
26. **Mainnet dust test**, through the production deployment first, and with the smoke script on mainnet if you want a second opinion:
    `SMOKE_CHAIN_ID=8453 SMOKE_AMOUNT_USD=1 SMOKE_I_UNDERSTAND_THIS_USES_REAL_MONEY=yes` (USDC on Base is built into the gateway's defaults;
    confirm the address against Circle's documentation before sending anything). The script refuses mainnet without that acknowledgement and caps the amount at $5.
27. **First real customers, narrowly:** a handful you know, one at a time. Every payout approved by a person (not the requester) and submitted by hand.
28. **First days:** reconcile every day (`05` section 3), review every alert, test `POST /alerts/test` weekly. No limit changes for at least the
    first weeks; any change needs a written reason and two people.
29. **Later:** only after weeks of clean daily reconciliation consider raising limits, or adding ZARP/OUSD (each needs issuer confirmation,
    dust tests, then enabling in the gateway's `ASSETS_ENABLED` *and* the bureau's `BUREAU_ENABLED_ASSETS`, one at a time).

## What I could not do, and why this is a plan not a result

The sandbox has no route to Base RPC endpoints, AWS, or any real service, so the testnet and mainnet legs have **not** been run. The smoke
script was proven against a local chain only. Treat the first run of every step above as the first test of it.
