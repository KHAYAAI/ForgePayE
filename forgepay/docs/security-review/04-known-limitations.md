# 04 - Known limitations and defects

Evidence base: commit `da11f54`. Path abbreviations: see [README.md](README.md). This list is deliberately blunt. It has
four parts: (1) defects the authors found while reading their own code to prepare this package, (2) limitations the
engineers had already written down, (3) documentation that does not match the code, (4) work in progress.

**Ratings are the authors' provisional ratings, not an independent assessment.** "Verified by experiment" means a
throw-away test in a scratch copy of the tree (not committed) reproduced the behaviour. "By reading" means traced
through the code but not executed. "Suspected" means a plausible failure that was not reproduced.

Recommendation (see [08-readiness-checklist.md](08-readiness-checklist.md)): fix or consciously accept the items in
section 1 marked **fix first** before engaging a reviewer, so their time goes to things the authors do not already know.

---

## 1. Defects found while preparing this package

### 1.1 Signing infrastructure (component A)

| Id | Rating | Fix first | Summary | Evidence | Basis |
|---|---|---|---|---|---|
| **F-01** | Critical | yes | The coordinator's HTTP API has **no authentication** and is plain HTTP: `POST /sign`, `POST /mpc/keys` (keygen), `POST /mpc/keys/{id}/reshare`, `POST /mpc/keys/{id}/retire-stale`. The api-gateway calls it with no credential. Network placement is the only control, and no `NetworkPolicy` for it exists at HEAD | `MPC/main.go:354-373`; `OFB/sign/sign.service.ts:321-350`; `OFB/custody/keys.service.ts:104-106,165-167,234,261`; `git grep -il "kind: NetworkPolicy" HEAD -- forgepay/services/openfireblocks` finds nothing | By reading |
| **F-02** | High | yes | The coordinator process **always loads a legacy single shared signing key** (from `MPC_SIGNER_PRIVATE_KEY`, from Vault KV where it is stored in plaintext and created if absent, or an ephemeral key). `MPC_REQUIRED=true` only stops `/sign` calls that omit `keyId`; the key stays in memory. `docs/threshold-signing.md:9-10` says the coordinator "holds only an ed25519 key" | `MPC/main.go:123-131,300-311`; `MPC/vault.go:34-86`; `MPC/signer.go:44-68` | By reading |
| **F-03** | High | yes | A single coordinator-signed request destroys a node's **active** key share. `retire` with `leaving:true` overwrites and unlinks every non-pending share below any `epoch` the caller names; there is no check that the node is really outside the new committee or that another committee holds the key. With no backup at HEAD, such requests to enough nodes (leaving fewer than `t+1` holders of a key) make that key unrecoverable | `MPC/internal/mpc/node.go:632-645`; `sealmigrate.go:90-99` | **Verified by experiment** (one request to one node: HTTP 200, share file gone) |
| **F-04** | High | yes | **Duplicate session id releases the original policy reservation.** `handleSign` reserves against the rolling limits *before* checking the session id is new; when the id is a duplicate it calls `Release(session)`, and `Release`/`live()` treat every reservation with that session id as released. A coordinator-key holder can therefore re-send a session id (with a zero-value transaction) to make a node forget what it already co-signed and defeat the daily limit | `node.go:394-409`; `policy.go:394-403,420-435` | **Verified by experiment** at the `Policy` level (reserve 900 of a 1 000 limit, duplicate reserve of 0, release: used = 0). The handler path is by reading |
| **F-05** | Medium | yes | **Negative transaction values are accepted.** `ethtx.ParseBig` allows `-5000`; the node signs the hash of a transaction that cannot be RLP-encoded and records a *negative* reservation, which increases the remaining daily budget. The gateway DTO blocks it (`^[0-9]+$`) so only a caller who reaches the coordinator or a node-signing request can use it | `MPC/internal/ethtx/ethtx.go:88-100`; `policy.go:194,383-390`; `OFB/sign/dto/sign-request.dto.ts:19-21` | **Verified by experiment** (daily limit 1 000 + one reservation of -5 000: a 5 900 reservation was accepted; the hash of a -5 000 transaction was produced while `MarshalBinary` fails) |
| **F-06** | Medium | no | Node policy limits (`maxValueWei`, `dailyLimitWei`) see only the native `value`. ERC-20 amounts are in calldata and are **not limited**. `allowedDestinations` checks the contract address only, not the recipient inside the calldata; the recipient blocklist inspects only `transfer`, `approve`, `transferFrom` | `policy.go:170-187,194-228,383-390` | By reading; design choice documented only as "the blocklist also checks the recipient inside a standard token transfer" (`threshold-signing.md:36`) |
| **F-07** | Medium | no | **Partial commit during a reshare has no working recovery.** If `commit` succeeds on some new members and fails on others, the coordinator says "Run the reshare again to finish", but a node that already committed returns 409 ("already holds a share for the next epoch") and the retry first aborts the pending shares on the others. For an `n`-of-`n` key the committed nodes no longer report the old epoch, so `KeyMeta` finds neither epoch agreed | `coordinator.go:613-621,727-734`; `node.go:555-561,615-631`; `KeyMeta` `coordinator.go:393-402` | Suspected; no test covers commit failure (`reshare_test.go` subtests listed in 05) |
| **F-08** | Low-Med | no | `KeyMeta` accepts an epoch group once `len(group) >= lead.Threshold+1` using the **reporting node's own** `Threshold`. One compromised node can report a high epoch with `threshold: 0` and block signing | `coordinator.go:393-402` | Suspected |
| **F-09** | Low-Med | no | The node audit log ignores write errors, the hash chain is unkeyed (anyone who can write the file can recompute it; truncating the tail is undetectable), and the file and the policy ledger are plaintext | `audit.go:58-73` (silent return at 66-69),`75-102`; `policy.go:437-452` | By reading |
| **F-11** | Low-Med | no | immudb credentials default to `immudb` / `immudb` when not set; audit is best effort | `MPC/audit.go:48-53`; `MPC/main.go:54-67,313-323` | By reading |
| **F-12** | Low | no | Peer-message keys derive from static-static X25519 with the session id as HKDF salt, so past traffic is decryptable if a node identity key leaks later. TLS 1.3 sits underneath only in production | `wire.go:49-61` | By reading |
| **F-13** | Info | no | CA private key and the coordinator seed are unencrypted files; there is no certificate revocation; replacing the coordinator key or a node identity needs a documented but untested restart procedure | `tls.go:198-224`; `identity.go:72-95`; `cluster.go:267-278` | By reading |
| **F-14** | Medium | no | `MPC_ENV=production` does **not** require a node policy; the node logs "will co-sign anything the coordinator asks" and `preflight` only warns | `node.go:129-136`; `cmd/mpc-node/main.go:176-180`; `preflight.go:92-93` | By reading |
| **F-15** | Low | no | The example KMS policy allows only `kms:Encrypt`/`Decrypt` with `purpose=deposit-keys`, but the MPC seal provider calls `GenerateDataKey` with context `mpc-node=<id>` and `Decrypt`; the example would not work for nodes and is described as the node policy in `threshold-signing.md:58-59` | `OFBDOC/deploy/aws/kms-policy.example.json`; `MPC/internal/mpc/sealprovider.go:441,465` | By reading |

### 1.2 Custody governance (component B, api-gateway)

| Id | Rating | Fix first | Summary | Evidence | Basis |
|---|---|---|---|---|---|
| **F-20** | High | yes | The quorum is **not cryptographic**: the acting signer is the unauthenticated `x-actor-email` header, trusted because the request carries the one static `ADMIN_API_KEY`. Whoever holds that key (or the console server) can cast every signer's vote | `OFB/custody/custody.controller.ts:41-54,67-93`; `OFB/auth/admin.guard.ts:15-32`; `CON/lib/openfireblocks.ts:32-50` | By reading |
| **F-21** | High | yes | **API-key issuance and revocation need no signer, no quorum and no cooling-off.** An API key signs any transfer the policy engine does not flag (< 10 ETH) with no human approval | `OFB/custody/custody.service.ts:508-544`; `sign.service.ts:217-221`; OPA `approval_rules.rego:5-12` | By reading |
| **F-22** | Medium-High | no | The policy engine never receives `data`/calldata, so an ERC-20 transfer has `value = 0` and passes value limits and the approval threshold; the OPA comparison uses `float64` (documented as accurate to a few thousand wei) | `OFB/policies/policy.service.ts:5-14`; `OFBDOC/services/policy-service/main.go:94-100,138-146`; `amount_limits.rego:3-8` | By reading |
| **F-23** | Medium | no | `executeSigning` does not check whether the `requestId` already has a signed row. `execute()` marks any thrown error `failed` and `retryTransfer` re-runs it. If an error occurs after the signature was stored (for example the DB update after a successful broadcast), a retry signs a second transaction with the next nonce. The code comment "Nothing was signed, so no nonce was consumed" is only true before persistence | `sign.service.ts:315-437` (comment at 420-423); `custody.service.ts:226-247,412-431` | Suspected |
| **F-24** | Medium | no | Votes are not bound to the proposal payload (no hash, no signature). A DB writer can alter an approved transfer's destination/value, add a signer, lower `threshold`, or set `cooling_off_hours` to 0 | `OFBDOC/infrastructure/init-custody.sql:45-69`; `custody.service.ts:280-283,386-392` | By reading |
| **F-26** | Low-Med | no | The Ethereum RPC URL (which may contain a provider key) is written to the log at start-up | `OFB/blockchain/ethereum.service.ts:46` | By reading |
| **F-27** | Low | no | A compiled-in default `DATABASE_URL` with password `dev-only` | `OFB/database/database.module.ts:20-22` | By reading |
| **F-28** | Low | no | Swagger UI and JSON are served without authentication | `OFB/main.ts:23-34` | By reading |
| **F-29** | Low-Med | no | Velocity limiting is off without Redis and fails open on a Redis error unless `RISK_FAIL_CLOSED=true` | `OFB/risk/risk.service.ts:42-45,76-87` | By reading |
| **F-30** | Low | no | The geographic policy relies on a `country` the caller supplies | `OFB/sign/dto/sign-request.dto.ts:52-54`; `sign.service.ts:153` | By reading |
| **F-31** | Low-Med | no | Default `TX_CONFIRMATIONS` is 1 and a `confirmed` transaction is never re-checked (reorgs not handled; documented) | `OFB/blockchain/tx-poller.service.ts:139,153-158`; `threshold-signing.md:128-129` | By reading |
| **F-32** | Info | no | `required = min(threshold, eligible signers)`: removing signers or adding ones still in cooling-off lowers the number of approvals a new proposal needs | `OFB/custody/quorum.ts:8-17` | By reading |
| **F-33** | Low-Med | no | A proposal is set to `executed` in the vote transaction and the action runs after commit; a crash in between leaves an approved transfer that is neither signed nor retryable (only `failed` proposals can be retried) | `custody.service.ts:294-313,226-247` | By reading |
| **F-34** | Low | no | Key creation: nodes hold the shares before the `custody.keys` row is inserted; a failure in between leaves an orphan key. Rotation updates the DB after the nodes have changed epoch (the nodes remain the source of truth) | `OFB/custody/keys.service.ts:165-181,243-246` | By reading |
| **F-35** | Medium | no | The schema script `init-phase1.sql` (part of the documented setup, mounted by `docker-compose.yml:20`) **seeds a tenant `demo` on the `pro` tier with a publicly known API key (`dev-demo-key`)**; a comment says to remove it in production, nothing enforces it. `docker-compose.yml:136` also defaults `ADMIN_API_KEY` to `dev-admin-key` | `OFBDOC/infrastructure/init-phase1.sql:69-82`; `OFBDOC/infrastructure/docker-compose.yml:20,136` | By reading |

### 1.3 Console (component B, `CON/**`)

| Id | Rating | Fix first | Summary | Evidence | Basis |
|---|---|---|---|---|---|
| **F-40** | High | yes | **Unauthenticated console routes act with the console's service credentials.** `POST /api/forge/bureau-verify`, `POST /api/forge/bureau-register`, `PUT /api/forge/bureau-disputes/:id` and `GET /api/forge/{treasury,bureau,bureau-agent-detail,bureau-scores,bureau-disputes,ontology}` have no `getCurrentUser()` check. Edge middleware covers only `/dashboard/*`. The service keys default to public strings if the env vars are unset | `CON/app/api/forge/bureau-verify/route.ts:14-20`; `bureau-register/route.ts:14-27`; `bureau-disputes/[id]/route.ts:13-21`; `CON/app/api/forge/[section]/route.ts:45-63`; `CON/middleware.ts:52-56`; `CON/lib/forge-services.ts:49-64` | By reading |
| **F-41** | High (conditional) | yes | **SSO callback can log in as an existing user of another tenant.** The tenant comes from the IdP's organization, but the user is looked up by email across all tenants and the session is created with *that user's* tenant. Exploitable by anyone who can attach an IdP to any tenant and assert a victim's email | `CON/app/api/auth/sso/callback/route.ts:40-53`; `CON/lib/auth.ts:248-253,293-303` | By reading; who may link an organization to a tenant is unverified |
| **F-42** | Medium | no | At signup the **7-day session JWT** is emailed as the "verification token" in a link. (No `/auth/verify-email` page exists, so the link does nothing else.) | `CON/app/api/auth/signup/route.ts:50-64`; `CON/lib/email.ts:36-55` | By reading |
| **F-43** | Medium | no | No rate limiting or lockout on login or MFA verification; a TOTP code can be reused inside its window; TOTP secrets and per-user API keys are stored in plaintext and the API key is returned at every login; backup codes are 40-bit unsalted hashes | `CON/app/api/auth/login/route.ts:19-93`; `mfa/verify/route.ts`; `CON/lib/mfa.ts:32-75`; `auth.ts:262-281,305-345` | By reading |
| **F-44** | Low-Med | no | The invitation link is returned to the inviter, ownership of the invited email is never verified, and the "email already has an account" reply allows account enumeration by any inviter | `CON/app/api/team/invitations/route.ts:35-45`; `CON/lib/invitations.ts:55-56` | By reading |
| **F-45** | Info | no | No default-deny for `app/api/**`: each route must call `getCurrentUser()` itself (cause of F-40) | `CON/middleware.ts:52-56` | By reading |
| **F-46** | Low | no | Any `NODE_ENV` other than `production` uses the public JWT secret `dev-secret-key` if `JWT_SECRET` is unset; the production guard rejects only that exact string, while the compose file uses another public string (`dev-secret-key-change-in-production`, 35 characters) that the guard would accept | `CON/lib/jwt-secret.ts:45-56,60-68`; `CON/docker-compose.yml:59` | By reading |
| **F-47** | Low | no | `users.email` uniqueness checks are case-sensitive (`email = $1`) while invitations and custody use `lower()` | `CON/app/api/auth/signup/route.ts:26-29`; `auth.ts:248-253` | By reading |

### 1.4 Stablecoin gateway and bureau (components C and D)

| Id | Rating | Fix first | Summary | Evidence | Basis |
|---|---|---|---|---|---|
| **F-50** | High | yes | **The `/payouts` routes have no admin or ownership check.** Any valid API key, including a merchant key, can create, list, **approve**, reject and submit any payout; `approved_by` and `requested_by` (`x-forge-service` header) are caller-supplied strings. Sweeps, treasury and FX routes do check `kind === 'admin'`; payouts do not. The approval gate is therefore advisory, and no test covers it | `SGW/src/routes/payouts.ts:57-210` (esp. 59, 146-148); compare `SGW/src/routes/sweeps.ts:30`, `routes/treasury.ts:31`, `routes/assets.ts:39`; `SGW/__tests__/payouts.test.ts` | By reading |
| **F-51** | High | yes | **Idempotency-key squatting against furnisher payouts.** The bureau's key is `furnisher_<contributorId>_<YYYY-MM>` and its namespace is the header `x-forge-service: agent-credit-bureau`. With F-50, any API-key holder can create that payout first with their own address; the bureau's real request is "deduplicated", the bureau does not compare payee/amount with what it requested, and marks the furnisher's entries settled | `BUR/src/furnisher-payouts.ts:185-187,271-292,300-329`; `SGW/src/routes/payouts.ts:59,86-89`; `payouts.ts:312-322` | By reading |
| **F-52** | High (vs DB write) | yes | The sweeper reads the **destination from the `deposit_sweeps` row** at send time and never compares it with configured treasury; a DB writer can insert or alter a planned sweep and have the gateway decrypt a deposit key and send everything to an attacker. The same DB writer can insert an `approved` payout (sent up to the signer's daily cap) or reset the treasury cap | `SGW/src/lib/sweeper.ts:191-197,229-235,272,307`; `payout-signer.ts:211-221`; `treasury.ts:279-282` | By reading |
| **F-53** | Medium | no | `planRecovery` refuses to refund "the deposit's own token" by comparing the *symbol*; passing the contract address of the deposit's own token bypasses the rule and sends it to any destination (admin-only route) | `SGW/src/lib/sweeper.ts:384-397` (rule at 390-393) | By reading |
| **F-54** | Medium-Low | no | The rate limiter key is the raw `X-Forwarded-For` header with `trustProxy: true`, so it can be varied per request; the same pattern is in the bureau | `SGW/src/index.ts:61,64-73`; `BUR/src/index.ts:358-369` | By reading |
| **F-55** | Medium | no | Production protections hinge on `NODE_ENV === 'production'`, and `config.env` defaults to `development`. With it unset: any non-empty API key is admin (`api-key-auth.ts:189`), the deposit-key wrapping key is a fixed public byte pattern (`keystore.ts:52-61`), payouts are "simulated" (`payouts.ts:163-176`), and the bureau accepts the public default admin key (`BUR/src/auth.ts:70,106`). The Dockerfiles set `NODE_ENV=production` (`SGW/Dockerfile:28`) | as listed | By reading |
| **F-56** | Medium | no | `tx.wait()` has no timeout inside the single-threaded payout pass, so one underpriced transaction stops all payouts; any error during the wait (including an RPC outage) marks the payout `failed` although it may still confirm, and nothing reconciles `failed` payouts that have a hash | `SGW/src/lib/payout-signer.ts:257-263,363`; `payout-worker.ts:65-80`; `payouts.ts:495-503` | By reading |
| **F-57** | Medium | no | The rolling 24 h payout cap is checked then acted on without a lock; safe with one process, not with replicas | `SGW/src/lib/payout-signer.ts:308-316` | By reading |
| **F-58** | Info | - | No leader election: settlement, sweeper, payout worker and treasury timers run in every process (in progress, see section 4) | `SGW/src/index.ts:238-282` | By reading |
| **F-59** | Low | no | `keystore.ts` header and `README` say KMS wrapping is "bound to the deposit address by encryption context"; the code uses the constant `{purpose: "deposit-keys"}`. Address binding exists only in the AES-GCM AAD | `SGW/src/lib/keystore.ts:16,129,134,215,229,257` | By reading |
| **F-60** | Low | no | Asset header says USDC is the only asset allowed to run "unverified"; USDT has preset decimals too | `SGW/src/lib/assets.ts:17-19,54,209-215` | By reading |
| **F-61** | Low | no | `README` claims HD derivation per `(merchant, chain)` and lists EURC; the code generates a random wallet per deposit and supports USDC, USDT, ZARP, OUSD; upstream commit pin is a placeholder | `SGW/README.md:17,25,39-42`; `SGW/src/lib/deposit-open.ts:71` | By reading |
| **F-62** | Low | no | No TLS option on the Postgres pool; `statementTimeoutMs` is used as the connection timeout and no statement timeout is set | `SGW/src/lib/db.ts:36-46,68` | By reading |
| **F-63** | Info | - | Settlement and balance decisions trust one RPC provider per chain (default public endpoints); L2 finality is sequencer-level at 10 blocks | `SGW/src/config.ts:61-75`; `settlement.ts` | By reading |
| **F-64** | Low-Med | no | Events to unified-router are fire-and-forget; a failed forward is logged only, with no outbox or retry | `SGW/src/lib/events.ts:61-66`; `settlement.ts:306-321` | By reading |
| **F-65** | Info | - | FX is operator-entered; `set_by` is always `admin`; plausibility range 5-100 ZAR/USD is hard-coded | `SGW/src/routes/assets.ts:36-71` | By reading |
| **F-66** | Low | no | Sweep, treasury and payout confirmations default to 1 block | `SGW/src/lib/sweeper.ts:91`; `treasury.ts:103`; `payout-signer.ts:179` | By reading |
| **F-67** | Low | no | The gas-drip transaction hash is stored after `sendTransaction` returns, not before; a crash in between causes a second drip. The sweep transfer hash has the same window (a second transfer would revert and the sweep would be marked failed although funds moved) | `SGW/src/lib/sweeper.ts:284-285,307-312` | By reading |
| **F-70** | Medium-High | yes | **Concurrent top-up confirmations credit the same payment more than once.** `confirmTopUp` checks `receipt.status` before an `await` on the gateway and credits after it without re-checking. | `BUR/src/billing.ts:473-531` | **Verified by experiment**: three concurrent confirms of a $10 receipt produced a balance of $30 |
| **F-71** | Medium | no | The bureau ledger is in memory first; Postgres writes are asynchronous with three attempts then a log line; balance upserts from near-simultaneous calls are not ordered | `BUR/src/store.ts:35-105,160-167` | By reading |
| **F-72** | Low-Med | no | A furnisher's payout address can be changed by one admin call with no cooling-off or second approver | `BUR/src/index.ts:1859-1900` | By reading |

### 1.5 Build and supply chain

| Id | Rating | Fix first | Summary | Evidence | Basis |
|---|---|---|---|---|---|
| **F-80** | Low-Med | no | Container base images are `node:18-alpine` (console) and `node:20-alpine` (stablecoin gateway, bureau); by the Node.js release schedule as the authors understand it, Node 18 is past end of life and Node 20's scheduled end of life was April 2026 (verify) | `CON/Dockerfile:1,12`; `SGW/Dockerfile:1,9`; `BUR/Dockerfile:1,9` | By reading |
| **F-81** | Medium | no | `npm audit --omit=dev` reports 6 / 6 / 16 / 5 untriaged advisories (stablecoin gateway / bureau / api-gateway / console; one critical in `next`); Go modules never scanned; Dependabot has no `gomod` entry and none for the openfireblocks api-gateway; no SBOM or image scan | `09-dependency-inventory.md`; `.github/dependabot.yml` | Tool output 2026-10-01 |

---

## 2. Limitations the engineers had already written down

These are quoted or paraphrased from the repository's own documents and comments. Nothing here is new, but a reviewer
should not have to find it.

**Threshold signing** (`OFBDOC/docs/threshold-signing.md:147-157` "What is not verified", and elsewhere):

- AWS KMS is tested only against a local fake that speaks KMS's protocol; `mpc-node seal-check -provider awskms` has
  never been run against a real account from this repository's environment (`:148-149`).
- Separate hosts: mTLS, the domain rule and preflight run locally; network partitions, clock skew and per-host secrets
  are not exercised (`:150-151`).
- The container image and example manifests were never built or run (`:152`).
- Domain labels in `cluster.json` are self-declared (`:153`).
- The seal key is in process memory after start-up (`:154-155`).
- Resharing needs every new member online and `t+1` old holders online; a new member needs a spare pre-parameter set,
  which is CPU-bound (`:92-95,156-157`).
- Resharing does not help against an attacker who already holds `t+1` old shares (`:97-102`).
- Broadcast: reorgs are not handled (a confirmed row is not re-checked), no fee bumping, and a permanently rejected
  signed transaction keeps its nonce until an operator removes it (`:128-129`); a stuck transaction is "never replaced
  automatically" (`OFB/blockchain/tx-poller.service.ts:22-31`).

**Stablecoin gateway** (`SGW/README.md:108-110`, code comments):

- KMS has not been run against a real AWS account from this repository's test environment.
- The cold address is an address only; moving money out of it is whatever controls it.
- Wrong-token discovery finds only tokens the gateway knows; others need an operator to name the contract.
- There is no live market feed for FX; "this is the seam where one would go" (`SGW/src/lib/fx.ts:14`).
- A payout found in flight with no recorded hash is marked failed for a person to check; a retry could pay twice
  (`SGW/src/lib/payout-worker.ts:12-17`). "The window is a few milliseconds, but it exists."
- Shielded payments are off by default; the Groth16 verifier is a stub that returns true when no registry is deployed
  (`SGW/src/config.ts:93-107`, `SGW/src/lib/proof-verifier.ts:15-24,47-74`). Not otherwise analysed here.

**Bureau**: the balance ledger is single-process (`BUR/src/billing.ts:101-112`); `generateZKProof` is a sha256 stub
(`BUR/src/index.ts:100-126`, out of scope here).

**Policy service**: wei values above 2^53 lose exactness in OPA comparisons (`OFBDOC/services/policy-service/policies/amount_limits.rego:3-8`).

**Platform-level**, from `OFBDOC/docs/security/audit-checklist.md` and `threat-model.md` (both partly out of date, see
section 3): no mTLS between internal services, no WAF, PostgreSQL row-level security scaffolded but not enforced,
no external penetration test, no external cryptographic audit, no HSM-backed Vault auto-unseal, no documented key
ceremony or rotation procedure.

---

## 3. Documentation that does not match the code

| Document | Statement | Reality |
|---|---|---|
| `OFBDOC/docs/threshold-signing.md:9-10` | The coordinator "holds only an ed25519 key" | It always loads the legacy shared key too (F-02) |
| `threshold-signing.md:19` | "Everything on disk is AES-GCM sealed" | Identity, pre-parameters and shares are sealed; `audit.log`, `policy-ledger.jsonl`, `identity.json`, the CA key, the coordinator seed and `seal.key` (file provider) are not |
| `threshold-signing.md:58-59` | `kms-policy.example.json` is the least-privilege policy for the KMS seal provider | It is the deposit-key policy and would not allow the node's calls (F-15) |
| `threshold-signing.md:81-86` | Reshare steps leave "the key usable as before" on failure | True through the probe; recovery after a partial commit is not (F-07) |
| `OFBDOC/docs/security/threat-model.md` | "API-key hashing at rest (currently stored as-is)"; "distributing the parties across isolated hosts ... remaining Phase 2 work" | API keys are hashed (`customer.service.ts:25-41`); live multi-party transport exists |
| `OFBDOC/docs/security/audit-checklist.md` | "Real MPC ... in-process only ... live multi-party transport ... remaining" | Multi-process nodes with peer transport exist (`MPC/cmd/mpc-node`, `internal/mpc/node.go`); the checklist is stale |
| `SGW/README.md:17,25` | Supported tokens USDC/USDT/EURC; HD wallet derivation | USDC, USDT, ZARP, OUSD; random wallet per deposit (F-61) |
| `SGW/src/lib/keystore.ts:16` | KMS context binds to the deposit address | Constant context (F-59) |
| `SGW/src/lib/treasury.ts:21-22` | "a compromise of the gateway exposes at most the payout wallet's float plus the operating wallet's ceiling, not the treasury" | Also exposes the gas wallet and every unswept deposit key reachable through the Vault/KMS role |
| `SGW/src/lib/assets.ts:17-19` | USDC is the only asset allowed to be "unverified" | USDT as well (F-60) |
| `SGW/README.md:96-97` | "Unit tests and the end-to-end run use a real Vault and a stand-in for AWS KMS" | The unit tests use local HTTP stand-ins for both (`SGW/__tests__/keystore.test.ts:104-125,173`); a real Vault is used only by the e2e script when `E2E_KEY_WRAP=vault` |
| `OFB/sign/sign.service.ts:420-423` | "Nothing was signed, so no nonce was consumed" | Only before persistence (F-23) |

---

## 4. In progress, and what this package does not cover

Another engineer was working in the same tree while this package was prepared. The four items below are described by
the owner as being finished: key-share backup / disaster recovery in the Go signer, leader-locking for gateway
workers, an alert-routing module, and a live FX-rate source.

At the reviewed commit **none of them exists in committed code** (`git ls-tree` of `MPC/internal/mpc`, `SGW/src`: no
backup, leader, alert or live-FX source files; `fx.ts:14` says the feed "is not wired in"). While this package was being
written, **uncommitted files for each appeared in the working tree** (names listed in README section 7). They were not
read or assessed. Consequences for this document:

- F-03 (destructive retire), F-58 and F-57 (no leader election), F-64 (no alert path) and F-65 (operator-entered FX)
  describe HEAD and may change.
- Anything described here as "no backup" or "no alerting" is true only of `da11f54`.

**The package must be refreshed (line numbers, section 1 statuses, test counts, and the new code reviewed) when those
changes are committed and a review tag is cut.**
