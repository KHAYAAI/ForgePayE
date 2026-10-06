# Launching the Credit Bureau: a beginner's guide (laptop, testnet, AWS, mainnet)

**Who this is for:** someone who has not launched a service on AWS or touched a blockchain before. It goes in order and says why.
`00-LAUNCH-STEPS.md` is the compact checklist version; this one explains. **Nothing in here has been run for you.** Every step
that creates cloud resources, handles keys or moves money is yours to do or approve, and the first time you do each one is its first test.

**The one rule to hold on to:** do each stage fully before the next. If something does not match what this guide says you will see,
stop and fix it. Do not push on hoping.

## Words you will meet

| Word | Plain meaning |
|---|---|
| **Staging / production** | Staging is a practice copy of the service on real cloud, with no real customers or money. Production is the real one. |
| **Testnet / mainnet** | A blockchain with worthless test money (testnet, here **Base Sepolia**) versus the real one (mainnet, here **Base**). Same software, so mistakes on testnet are free. |
| **USDC** | A dollar stablecoin. The bureau is paid and pays in USDC on Base. Test USDC on testnet is free from a faucet. |
| **Wallet / private key** | A wallet is an address that holds tokens. Its private key is the password that moves them. **Anyone with the key owns the funds.** |
| **RPC provider** | A company whose server lets software talk to the blockchain (Alchemy, QuickNode and similar). |
| **Secret** | A password-like value (database password, API key). Never put one in the code, in chat, or in a ticket. |
| **AWS Secrets Manager** | AWS's safe for secrets. The service reads them at start-up. |
| **KMS** | AWS's key safe: it encrypts things without ever showing you the key. |
| **Terraform** | A tool that builds AWS resources from files, so the setup can be read and repeated. |
| **Kubernetes (EKS) / Helm** | The system that runs the service containers on AWS, and the tool that installs a service into it. |
| **Fail closed** | If a safety check cannot run, the service refuses to proceed instead of waving things through. The bureau does this on purpose. |

## Safety rules (read these twice)

1. **Never paste a private key, secret or password into chat, an email, a ticket or the repository.** Not to me either.
2. **Generate wallets offline** (a hardware wallet, or a machine that is not online), and use **different wallets** for staging and
   production. Never reuse a testnet wallet on mainnet.
3. **Money steps in order, small first.** Testnet, then a mainnet test of a few dollars, then real customers one at a time.
4. **Two people** approve anything that moves real money, and a person other than the requester approves payouts.
5. **Turn on billing alerts first** so a mistake cannot become a surprise bill.

---

## Stage 1: Run it on your own computer (about an hour)

**Goal:** see the bureau work and learn what "ready" looks like, with no cloud and no money.

You need: Node 22, Git, PostgreSQL, Redis. Then:

```bash
git clone <the repository> && cd ForgePayE
git checkout claude/forgepay-platform-design-gEkgE
cd forgepay/services/agent-credit-bureau
npm ci
npm test            # expect all to pass (about 400, a few skipped)
npm run build
```

Start it in **production mode** against a throwaway local database. This is the same mode the real service runs in, so it shows you the
safety checks:

```bash
export NODE_ENV=production PORT=3918 \
  CORS_ORIGIN=https://console.myforgepay.com \
  DATABASE_URL=postgres://USER:PASS@localhost:5432/bureau_local \
  REDIS_URL=redis://localhost:6379/5 \
  BUREAU_ADMIN_API_KEY=$(openssl rand -hex 32) \
  CONSENT_SIGNING_SECRET=$(openssl rand -hex 32) \
  COMPLIANCE_MONITOR_URL=http://127.0.0.1:8903 TRUST_PROXY_HOPS=1
node dist/index.js
```

In a second terminal, check it and register a first agent (use the same admin key you exported):

```bash
curl localhost:3918/health
curl -X POST localhost:3918/v1/agents/demo1/profile -H "x-api-key: $BUREAU_ADMIN_API_KEY" -H 'content-type: application/json' \
  -d '{"agentId":"demo1","did":"did:forge:agent_demo1","operatorEntityId":"op_demo","operatorEntityType":"llc","operatorLegalName":"Demo Ltd"}'
curl localhost:3918/v1/agents/demo1/score -H "x-api-key: $BUREAU_ADMIN_API_KEY"
```

**What you should see:** a new agent scores **300, grade C, tier DEEP_SUBPRIME**, with `THIN_FILE` among its factors. That is the
"new agents start at the bottom" rule. A request without the key gets **401**. Stop the service, unset `BUREAU_ADMIN_API_KEY`, start it
again: it refuses to start. That refusal is correct.

The sanctions check (`POST /v1/verify/sanctions`) will say **not clear** here because no compliance monitor is running. Also correct:
it fails closed.

## Stage 2: AWS and your domain (a few days, mostly waiting)

**Goal:** a staging copy of the bureau on AWS that you can reach over the internet at a real name. Staging first, always.

### 2a. The AWS account

1. Create a **separate AWS account for staging** (and later another for production). Use an email only your company controls.
2. Turn on **MFA** for the root user, then stop using root. Create an administrator through **IAM Identity Center**, and sign in as that user.
3. **Budgets:** create a monthly cost budget with email alerts at 50% and 100%.
4. **Pick a region.** The repo's staging scripts default to `af-south-1` (Cape Town), which is **off by default** in new accounts: enable it in
   *Account settings > AWS Regions* first. `us-east-1` is also supported. The TLS certificate for CloudFront must be in **us-east-1** whatever region you pick.
5. On your computer install: AWS CLI v2, Terraform (1.6 or newer), kubectl, Helm, Docker, jq. Then `aws sso login` and check with
   `aws sts get-caller-identity`.

### 2b. The domain (myforgepay.com)

1. In Route 53 create a **hosted zone** for `myforgepay.com`. Copy its four name servers.
2. At your domain registrar, set the domain's name servers to those four. DNS can take hours to switch.
3. In **ACM** (region us-east-1) request a certificate for `myforgepay.com` and `*.myforgepay.com`, using **DNS validation**; add the
   records ACM gives you in Route 53. Wait for status *Issued*.
4. Mailboxes: set up the addresses the code uses (for example `noreply@myforgepay.com`) with your mail provider.

### 2c. Secrets

On a trusted machine, **outside the git folder**:

```bash
cd forgepay/infra/launch/bureau
./generate-secrets.sh ~/forge-secrets.env       # writes 4 random secrets, mode 0600, never prints them
```

Copy `launch.env.template` to a place outside the repo, fill in the non-secret values, append the secrets file, then:

```bash
node preflight.mjs ~/my-launch.env
```

**It must end with "All required settings present."** (A line about the South African list being a recorded copy is a warning, not a
failure.) Then store each secret in **AWS Secrets Manager** (one secret holding the keys the chart expects is fine; the key names are in
the comment at the bottom of `infra/helm/agent-credit-bureau/values.yaml`), and **delete `~/forge-secrets.env`**.

### 2d. Build the cloud resources

The repo builds AWS with Terraform and runs services on Kubernetes (EKS). It is the heavier of the two ways to run a service, and it
is the one the repo supports.

```bash
./forgepay/infra/staging/aws-prerequisites.sh af-south-1                 # once: creates the Terraform state store
./forgepay/infra/staging/deploy-staging.sh af-south-1 --dry-run          # shows what it WOULD do; read all of it
```

Read the dry run before you run it for real. It lists what will be created (a network, a Kubernetes cluster, a database, Redis, keys)
and you should check what each costs to keep. **Expect to fix things: this has never been applied to a real account.** The
staging names are subdomains such as `staging.af.myforgepay.com`. The script deploys the whole platform; for a bureau-only soft launch
you can re-run it with `--skip-terraform` once the infrastructure exists and install only the services below with Helm. Tear staging
down when you are not using it (`teardown-staging.sh`), because it costs money while it exists.

### 2e. Put the services on

Order matters, because the bureau depends on the others:

1. **Postgres** (managed, with backups on).
2. **compliance-monitor** (`infra/helm/compliance-monitor`). Check its `/health` and logs: it must show the sanctions lists **loaded**.
   Until they load, the bureau's sanctions screen refuses everyone. In the launch settings the South African list is read from the
   bundled copy (see the template); OFAC, EU and UN download from their sites.
3. **agent-identity** (`infra/helm/agent-identity`), which the bureau asks to confirm agent identities.
4. **The bureau**, using the image the **`forgepay-bureau-images`** workflow builds and scans (deploy by the digest in its run summary):

```bash
helm upgrade --install bureau forgepay/infra/helm/agent-credit-bureau -n forgepay \
  --set image.repository=<registry>/forgepay-agent-credit-bureau \
  --set image.tag=<the digest or tag from the workflow summary>
```

5. **The console**, after the bureau is healthy. Check which chart under `infra/helm/` deploys `apps/platform` (look at `dashboard` and `forgepay-stack`) before installing: that mapping has not been confirmed. Its image is built by the same workflow.
6. In Route 53 point the staging names (for example `console.staging.af.myforgepay.com`) at the load balancer. Use the production names (`console.myforgepay.com`, `api.myforgepay.com`) only in the production account.

### 2f. Check staging

Run each of these and write down the result:

- `GET /health` on the bureau returns `ok`, and `persistenceFailures` is 0.
- Register a test agent: it shows 300 / DEEP_SUBPRIME.
- **Sanctions:** screen a name from a public sanctions list and confirm it is **refused**. Then stop the compliance monitor and confirm the
  bureau **refuses** rather than proceeding.
- Restart the bureau pod: the test agent is still there (it is stored in the database, not in memory).
- Sign in to the console, enable the bureau, and see only your own workspace's agents.
- **Alerts reach a human** within five minutes (`POST /alerts/test` on the gateway, once you run it).

## Stage 3: Testnet on Base Sepolia (a week, with the two "dust" days)

**Goal:** prove the money path (the bureau charging per report and paying furnishers in USDC) using worthless tokens, on the real staging setup.

1. **Wallets.** Generate throwaway ones offline: payer, payout, gas. These are *testnet only*: never reuse them later.
2. **Test funds.** Get Base Sepolia ETH from a public faucet and test USDC from Circle's own faucet. **Check the test USDC contract address
   on Circle's documentation yourself.** Do not copy an address from this guide or from anyone's message.
3. **An RPC provider** account (a paid plan). Keep the key in a secret, not in the URL in a config file.
4. **Run the smoke script** from a machine that can reach the RPC (the build environment cannot). It tests: the token, a deposit of an exact
   amount, the sweep, an approved payout, and reconciliation. Every line must **PASS**:

```bash
cd forgepay/services/stablecoin-gateway
SMOKE_RPC_URL=https://sepolia.base.org SMOKE_CHAIN_ID=84532 SMOKE_USDC=<verified test USDC> \
SMOKE_PAYER_KEY_FILE=~/.smoke/payer.key SMOKE_SIGNER_KEY_FILE=~/.smoke/payout.key SMOKE_GAS_KEY_FILE=~/.smoke/gas.key \
SMOKE_TREASURY=<an address you control> node scripts/chain-smoke.cjs
```

5. **Run it twice, a day apart**, and compare balances in between. A balance that changes on its own is a red flag.
6. **Point staging at Base Sepolia** and repeat the same flow through the real deployment (`03-infrastructure-and-dust-test.md`).
7. **Play the bad days** (`05-operations-runbook.md`, section 5): stop the monitor, kill a pod, restore the database from a backup. Do each once and fix what breaks.

**Pass mark:** every smoke check passes twice, balances match to the cent, alerts reached a person, the restore worked.

## Stage 4: Soft launch to design partners (still on testnet, then a first real dollar)

1. Pick **three to five partners you know**. Tell them plainly what it is: early access, a new agent starts at the bottom, Mode 2 (on-chain)
   is thin, no lending runs through FORGE yet.
2. Give each their own workspace in the console and (for lenders reporting payments) a furnisher key. Watch the first real reports go in.
3. Run **daily reconciliation** (`05`, section 3), read every alert, test alerts weekly.
4. Keep the **conservative limits** (`04-conservative-launch.md`): every payout approved by a person, small ceilings, USDC only. Change nothing for weeks.

## Stage 5: Mainnet (only after the gates below)

**Gates, all true first:**

- [ ] Counsel's written answers received and acted on (`02-counsel-brief.md`), including FIC registration if required
- [ ] Independent review of the money paths done, findings fixed and re-checked (`01-review-engagement.md`)
- [ ] Stage 3 complete with no unexplained balance difference
- [ ] Sanctions proven to refuse a listed name and to fail closed, in the production-shaped deployment
- [ ] On-call named, alerts tested this week, restore drilled, a person owns daily reconciliation
- [ ] You can stop the money in minutes: set `payout.signerEnabled=false` (outflows stop; deposits can still arrive)

**Then:**

1. Build **production** in its own AWS account with its own secrets and its own offline-generated wallets. Repeat the Stage 2f checks there.
2. Fund the payout wallet with **a few dollars of USDC plus gas**, and the gas wallet with a little ETH. No more.
3. **Mainnet is chain id 8453 (Base), not 84532.** Confirm the real USDC contract address on Circle's documentation before sending anything.
4. Do a **$1 mainnet test** through the production deployment: a deposit, a sweep, a payout approved by a second person, reconciliation.
   The smoke script refuses mainnet without `SMOKE_I_UNDERSTAND_THIS_USES_REAL_MONEY=yes` and caps the amount at $5.
5. **First real customers one at a time**, every payout approved by a person other than the requester.
6. Only after weeks of clean daily reconciliation consider raising limits, and then with a written reason and two people.

## Stage 6: Public launch

Public, open sign-up comes after the soft launch has run cleanly, the gates above are closed, and you have read the review firm's
final report. Keep the website claims to what the product does (the bureau page was corrected for this).

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Bureau exits at start: "refuses to start ... BUREAU_ADMIN_API_KEY" | A required secret is missing or still a dev value | Run `preflight.mjs`; fix the setting named |
| Bureau exits: CORS_ORIGIN | It is unset or `*` in production | Set the console's real origin |
| Sanctions screen says "not clear" or `error` for everyone | A list has not loaded or is too old, or the monitor is unreachable | Check the monitor's `/health`; check list ages; check `COMPLIANCE_MONITOR_URL` and the key |
| Console shows "product not enabled for this workspace" | The workspace has not switched the bureau on | Enable it in the console's products page (needs the product catalog service up) |
| Console shows a service as not live | It cannot reach the bureau (URL, key, or network policy) | Check `AGENT_CREDIT_BUREAU_URL` and that the admin key matches on both sides |
| A balance does not match | Do not continue | Stop payouts (`payout.signerEnabled=false`), run `POST /reconcile/run`, follow `05` |
| Terraform plan wants to delete something | A real risk | Stop and read why before applying anything |

## What is still not done (as of 6 October 2026)

AWS account and domain setup, real secrets, the first Terraform apply, the live-list staging run, any Base Sepolia transaction,
counsel's answers, the independent review, FIC registration, and confirming the FIC list's download address (the launch settings use a
bundled copy that expires after 30 days). Each is a step above.
