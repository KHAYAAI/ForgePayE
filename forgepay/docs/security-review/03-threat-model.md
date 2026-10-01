# 03 - Threat model

Evidence base: commit `da11f54`. Path abbreviations: see [README.md](README.md). Finding ids (F-nn) are defined in
[04-known-limitations.md](04-known-limitations.md). This is the authors' own model, written to be attacked; it is
**not** an independent assessment.

## How mitigations are labelled

Every mitigation below carries one of these tags. Where a mitigation depends on a person doing something, or only
exists in development, the tag says so.

| Tag | Meaning |
|---|---|
| **[tested]** | Enforced in code and an automated test cited in [05-test-evidence.md](05-test-evidence.md) exercises it |
| **[code]** | Enforced in code, no test found that exercises the property |
| **[config]** | Only true if operators set it up correctly (env var, file, topology); the code cannot prove it |
| **[convention]** | Relies on a rule or habit with no enforcement in code |
| **[dev-only]** | True only when `NODE_ENV`/`MPC_ENV` is development, or a dev shortcut that production refuses |
| **[absent]** | A mitigation one would expect; no code found |
| **[unverified]** | Believed true from reading, not demonstrated |

"Verified by experiment" means the authors ran a small throw-away test in a scratch copy of the tree while preparing this
package (the tests are not committed; they are described in 05).

---

## Component A - Threshold-ECDSA custody (`MPC/**`)

### A.1 Assets

Workspace keys (as shares), the ability to sign, node identity and seal keys, the integrity of each node's policy and
audit trail, and availability of `t+1` nodes.

### A.2 Trust assumptions (what the design takes on faith)

1. At most `t` nodes are compromised at any time, and compromised nodes are not all in one real administrative domain.
   The `domain` field in `cluster.json` is a *declaration*; the code refuses a topology that visibly puts `t+1` nodes in
   one domain (`MPC/internal/mpc/cluster.go:164-217`) **[tested]** (`topology_test.go:27-102`) but "cannot prove a label is
   true" (`cluster.go:156-163`) **[convention]**.
2. Every node's local `cluster.json` carries the right peer public keys and coordinator public key. It is unsigned and
   re-read on mtime change; changing the coordinator key or a node identity key by hot reload is refused
   (`cluster.go:250-282`) **[code]**.
3. The pinned `bnb-chain/tss-lib v2.0.0` implements threshold ECDSA and resharing securely **[unverified - this is the
   main question for the reviewers, see 06]**.
4. Clocks agree within 2 minutes (`node.go:36,252`).
5. Vault/KMS is available when a node starts (not while it signs) (`sealprovider.go:37-40`).
6. The private CA key is held by someone the operators agree on (`tls.go:195-197`) **[convention]**.

### A.3 Attackers, what they can reach, and what stops them

| Attacker | What they can do today | What stops them | Residual risk |
|---|---|---|---|
| **External, network only, no credentials** | Reach the coordinator's HTTP port if the network allows it: `POST /sign`, `POST /mpc/keys`, `POST /mpc/keys/{id}/reshare`, `POST /mpc/keys/{id}/retire-stale`, `GET /mpc/status` (`MPC/main.go:354-363`). No authentication, plain HTTP (`main.go:366-373`). Can request signatures for any workspace key *if they know its key id and address* (neither is secret: both are stored in `custody.keys` and shown in the console) and create arbitrary new keys (consuming pre-parameters and creating orphan keys) | Nodes themselves are unreachable without a certificate from the CA when `MPC_ENV=production` (`node.go:195-215`) **[tested]** (`topology_test.go:104-181`). Each node applies its own policy to every signing request (`node.go:393-403`) **[tested]** (`cluster_test.go:494-580`). Network placement of the signer: no `NetworkPolicy` exists for it at HEAD (`git grep` over `forgepay/` finds policies for other services only) **[absent]** | **High** until the coordinator API is authenticated (F-01). Anything within node policy can be signed; with no node policy configured (production does not require one, F-14) anything can |
| **Malicious node operator (one node)** | Reads that node's share (via the seal key in memory / Vault token); edits that node's policy file; refuses to sign; destroys its own share; returns lies to the coordinator's read-only GETs (`/v1/keys/{id}`, `/v1/sessions/{id}`); sends protocol messages as itself | One share reveals nothing about the key when `t >= 1` **[tested]** (`cluster_test.go:361-388` checks shares differ; secrecy is the library's property). Peers accept messages only from the cert-authenticated sender id (`node.go:664-674`) **[tested]** (`topology_test.go:166-174`). Coordinator needs agreement from `t+1` holders on epoch/threshold before it believes a report (`coordinator.go:393-402`) | Medium: a single lying node can make `KeyMeta` report an inflated epoch with `threshold 0` and a one-member group (the quorum test uses the *reporter's own* threshold), blocking signing until a person intervenes (F-08, **[unverified]**). A malicious node may abort sessions at will (availability) |
| **Malicious platform operator holding the coordinator key (and cert)** | Everything in the first row, plus: send a `retire` request with `leaving:true` and a huge epoch to any node and destroy every active share it holds (`node.go:632-645`; **verified by experiment**: one signed request deleted the only active share, F-03); reuse a session id to release a prior policy reservation, defeating the daily/hourly limits (`node.go:404-408` + `policy.go:394-403`; **verified by experiment** at the `Policy` level, F-04); send a transaction with a negative `value` that credits the daily budget (`ethtx.go:88-100`, `policy.go:383-390`; **verified by experiment**, F-05); reshare a key to any committee among the cluster's nodes | Request signing: ed25519 (`node.go:243-247`) **[tested]**. Cannot sign beyond what each node's static rules allow (`policy.go:190-228`) **[tested]** | **High**: the coordinator is a single point whose compromise removes the rolling limits and can permanently destroy key material (no backup at HEAD) |
| **Compromised dependency** | Code running inside a node reads the share and the in-memory seal key and exfiltrates them; inside the coordinator it reads the coordinator key and the legacy key. The node binary links `tss-lib`, `go-ethereum`, AWS SDK v2, `uuid`; the signer additionally links `immudb`, `hashicorp/vault/api`, `gorilla/mux`, Prometheus (`MPC/go.mod:9-20`) | Pinned versions in `go.mod`/`go.sum` **[code]**; distroless non-root images (`MPC/Dockerfile`, `Dockerfile.node`) not built or run by the authors (`threshold-signing.md:152`) **[unverified]**. No `govulncheck` run was possible (tool absent); Dependabot has no `gomod` entry (`.github/dependabot.yml`) **[absent]** | A single compromised node dependency yields one share (bounded by `t`); a compromised coordinator dependency yields the legacy key and the means to destroy shares |
| **Compromised single node host** | Share (sealed on disk; plaintext in memory while signing), seal key in memory, identity key, mTLS key, policy file, audit log | `t+1` needed. Seal key not on disk in production **[config]** (`sealprovider.go:61-79`, `preflight.go:57-68`) | The docs concede a memory-reading attacker on a running node gets that node's share (`threshold-signing.md:154-155`) |
| **Compromised gateway** | Calls the signer freely (no credential) with any transaction it likes for any workspace key it can name | Node policy only (rows above). Gateway's own policy/approval checks are *not* a barrier once the signer is reached | **High** (F-01) |
| **Compromised DB (gateway)** | Rewrites `custody.keys` (address, nodes, epoch) | A node refuses a request whose `expectedAddress` does not match its stored key (`node.go:368-372`) **[tested]** (`cluster_test.go:430-446`); epoch/committee come from the nodes, not the DB (`coordinator.go:297-300`) **[tested]** (`reshare_test.go`) | Low for key custody; governance consequences are in component B |
| **Compromised Vault/KMS role** | Unwrap one node's seal key (needs that node's disk to use it); for the legacy key, read `secret/openfireblocks/mpc-signer` | Per-node wrapping key bound to node id (KMS context / Vault payload) **[tested]** (`sealprovider_test.go:58-108,184-212`); example least-privilege Vault policy **[config]**. If one Vault serves all nodes, a Vault-admin compromise yields all seal keys (disks still needed) **[convention]** | Medium. The KMS example policy does not match the node's calls (F-15) |

### A.4 STRIDE

| | Threat | Mitigation in code | Status | Residual |
|---|---|---|---|---|
| **S** | Forged coordinator request | ed25519 over the exact body bytes + `X-Coordinator-Signature` (`wire.go:98-107`, `node.go:237-261`); mTLS CN must be `coordinator` for any POST except `/v1/msg` (`node.go:207-212`) | **[tested]** `cluster_test.go:448-471`; signature is not bound to the endpoint path or recipient node, so a captured body could be replayed to a different endpoint that parses it (see 06 Q-7) | Low-Med |
| S | Forged peer message / wrong sender | AEAD key derived from the pair, session, direction; AAD covers routing fields (`wire.go:49-96`); cert CN must equal `from` (`node.go:664-674`); `FromParty`/`ToParty` must belong to the named nodes (`node.go:665`) | **[tested]** `cluster_test.go:51-83,486-492`, `topology_test.go:166-174` | Low |
| S | Node impersonation in a dev cluster | None without mTLS; AEAD still needed for protocol messages | **[dev-only]** (`node.go:195-197`: no TLS means no caller identity; production refuses, `node.go:129-136`) | n/a in production |
| **T** | Altered transaction between gateway and nodes | Each node rebuilds the transaction from fields and hashes it itself (`node.go:378-385`, `ethtx.go:36-85`); nodes must agree on the signature and the coordinator recovers the sender (`coordinator.go:519-548`) | **[tested]** `cluster_test.go:396-446` | Low |
| T | Replay of a signed sign/keygen/reshare request | 2 min skew (`node.go:36,252-255`); session ids must be new for 10 min (`node.go:34,786-803`, janitor `1010-1026`) | **[tested]** `cluster_test.go:473-484`. After a node restart the in-memory session set is empty, so a captured body is replayable for up to 2 minutes (**[code]**, no test) | Low |
| T | Replay releasing a policy reservation | None: `Reserve` runs *before* the duplicate-session check and `Release(session)` frees every reservation with that session id (`node.go:394-409`, `policy.go:394-403,420-435`) | **[absent]**; **verified by experiment** (Policy level) | **Medium-High** (F-04) |
| T | Negative transaction value | Gateway DTO rejects non-digits (`OFB/sign/dto/sign-request.dto.ts:19-21`), but `ethtx.ParseBig` accepts `-`, the node signs the hash of an unencodable transaction and records a negative reservation (`ethtx.go:88-100`, `policy.go:383-390`) | **[absent]** at the node; **verified by experiment** | **Medium** (F-05) |
| T | Tampered share file / wrong-node share | AES-GCM with AAD; wrong seal key or AAD fails (`seal.go`, `node.go:1078-1095`) | **[tested]** `cluster_test.go:30-49,361-388` | Low |
| T | Overwriting a share | link-not-rename; keygen refuses an existing key id (`node.go:306-309,1138-1140`) | **[tested]** `cluster_test.go:390-394` | Low. No fsync of file or directory before success is reported (`node.go:1135-1140`) **[code]** |
| T | Altered node policy by a host administrator | Coordinator cannot change it; bad edit keeps old rules (`policy.go:305-312`) | **[tested]** `cluster_test.go:566-570`, `policy_test.go:125-154`; an administrator can still edit the file or the ledger **[convention]** | Accepted |
| T | Altered or truncated audit log | Hash chain, `mpc-node verify-audit` (`audit.go:75-102`) | **[tested]** `cluster_test.go:151-173` (edit and removal in the middle). Unkeyed; tail truncation and full recomputation undetected; file open errors ignored (`audit.go:66-69`) | Medium (F-09) |
| **R** | "I did not sign that" | Per-node audit lines (to, value, nonce, hash, committee, epoch) (`node.go:410-413`); coordinator events to immudb (best effort) | **[tested]** `cluster_test.go:589-606` for presence | Medium: logs are local and host-writable |
| **I** | Share exfiltration from disk | Sealed under the seal key; production requires Vault/KMS-wrapped seal key (`sealprovider.go:61-79`) | **[tested]** `sealprovider_test.go:122-182`; **[config]** | Low-Med |
| I | Protocol secrets on the wire | Messages AES-GCM under a per-pair per-session key; transport mTLS TLS 1.3 (`wire.go`, `tls.go:113-132`). No forward secrecy at the message layer (static X25519) | **[tested]** (authenticity); secrecy by construction | Low-Med (F-12) |
| I | Sensitive data in plaintext logs/ledgers | Audit and ledger contain destinations and values in clear (`audit.go`, `policy.go:437-452`); `docs/threshold-signing.md:19` says "Everything on disk is AES-GCM sealed" (F-10) | **[absent]** | Low |
| **D** | Unauthenticated callers of the coordinator | None (F-01) | **[absent]** | **High** |
| D | Pre-parameter exhaustion / CPU burn | One set per keygen/new share, refilled one core at a time (`preparams.go:85-114`); reshare refuses if a new member has none (`coordinator.go:633-637`) | **[code]** | An attacker with F-01 can exhaust sets and fill disks with orphan keys |
| D | Destruction of shares | `retire` with `leaving:true` is unconditional (`node.go:632-645`) | **[absent]**; verified | **High** (F-03) |
| D | Unbounded session / mailbox growth | `maxMailbox 512` per session id; TTL janitor (`node.go:37,693-698,1010-1026`); but the number of session ids is unbounded for any authenticated peer | **[code]** | Low |
| D | Single node refusing/lying | Quorum selection excludes failed nodes; at most 3 attempts (`coordinator.go:451-497`) | **[tested]** `cluster_test.go:416-428` | Low-Med |
| D | Partial commit during a reshare | The coordinator tells the operator "the old shares are untouched. Run the reshare again to finish" (`coordinator.go:731-733`), but a node that already committed refuses a new reshare because it "already holds a share for the next epoch" (`node.go:556-561`), and the retry first *aborts* pending shares (`coordinator.go:613-621`) | **[absent]** recovery; **[unverified]** (no test) | **Medium** (F-07): can leave a 3-of-3 key unusable without manual file surgery |
| **E** | A peer starting ceremonies | Only CN `coordinator` may POST except `/v1/msg` | **[tested]** `topology_test.go:162-165` | Low |
| E | Signing something a node cannot read | Probe digests are fixed-form `keccak256("forge-mpc-probe\|key\|epoch\|nonce")` and cannot be a transaction hash (`node.go:429-433`) | **[code]**; reviewer question 06 Q-4 | Low |
| E | Policy bypass through ERC-20 calldata | Native `value` caps and daily limit do not see token amounts; allowlist checks only the contract; recipient blocklist only inspects `transfer/approve/transferFrom` (`policy.go:170-187,194,221-225`) | **[tested]** for what it checks (`cluster_test.go:539-547`); the gap is by design | **Medium** (F-06) |
| E | Legacy shared key reachable | `MPC_REQUIRED=true` refuses `/sign` without `keyId` (`main.go:123-131`) but the key is loaded regardless (`main.go:300-311`) | **[code]** partial | **High** if `MPC_REQUIRED` unset (F-02) |

### A.5 What this model does not cover

Cryptographic soundness of the tss-lib protocol and of this repository's use of it; side channels in Paillier and
big-number arithmetic; behaviour on real, separated hosts (never tested, `threshold-signing.md:148-153`).

---

## Component B - Custody governance and console (`OFB/**`, `CON/**`)

### B.1 Assets

The signer roster and quorum state, the right to cause a signature, API keys, user sessions and roles, invitation
tokens, audit records.

### B.2 Trust assumptions

1. The console server is trusted: it holds `OPENFIREBLOCKS_ADMIN_KEY`, names the acting person in `x-actor-email`, and
   decides who may vote (`CON/lib/openfireblocks.ts:32-50`, `CON/app/api/forge/custody-action/route.ts:34-70`). The
   api-gateway believes it entirely (`OFB/custody/custody.controller.ts:41-54`) **[convention]**.
2. Postgres integrity (votes and payloads are not signed or hash-bound, F-24).
3. The policy-service (OPA) is reachable; if not, signing is denied (`OFB/policies/policy.service.ts:33-52`) **[tested]**
   (`policy.service.spec.ts`).
4. The signer is reachable only from the gateway **[convention]** (F-01).
5. The Ethereum RPC provider reports truthfully.

### B.3 Attackers

| Attacker | What they can do today | What stops them | Residual |
|---|---|---|---|
| **External, unauthenticated, via the console** | Call console API routes that do not check a session: `POST /api/forge/bureau-verify`, `POST /api/forge/bureau-register`, `PUT /api/forge/bureau-disputes/:id`, and `GET /api/forge/{treasury,bureau,bureau-agent-detail,bureau-scores,bureau-disputes,ontology}`, which call internal services with the console's admin credentials (`CON/app/api/forge/*/route.ts`; `CON/lib/forge-services.ts:49-64,262-322`). Guess passwords and TOTP codes with no throttling in the code (`CON/app/api/auth/login/route.ts`, `mfa/verify/route.ts`) | `middleware.ts` guards only `/dashboard/*` (`middleware.ts:52-56`) **[code]**; per-route checks exist for most other routes (`getCurrentUser`) **[code]**; no rate limit **[absent]** (an edge/WAF limit is possible but not evidenced) | **High** (F-40, F-43) |
| **Authenticated tenant user (analyst/approver/admin/owner)** | Whatever RBAC grants (`CON/lib/rbac.ts:25-40`); custody actions need `approve:payouts`, `manage:custody_policy`, `manage:api_keys` (`custody-action/route.ts:20-30`). The *actor* sent to the gateway is always the signed-in user, never browser-chosen (`route.ts:65`) | Role re-read from the DB on each request (`CON/lib/auth.ts:98-122`) **[code]**; products gate (`route.ts:37`) | Role changes made through the DB or SSO auto-provisioning (`auth.ts:293-303`) need no custody-side check beyond "is an active signer" |
| **Malicious insider with `manage:team` (admin/owner)** | Invite arbitrary emails with role up to `admin` and receive the invite link in the API response (`CON/app/api/team/invitations/route.ts:35-45`), accept it themselves, and create additional console identities; propose them as signers (needs existing quorum) | Invitation is hash-only, single use, 7 d (`CON/lib/invitations.ts:9,58-71,107-112`) **[code]**; adding a signer needs a quorum vote and a cooling-off (`custody.service.ts:147-175,341-355`) **[code]** | Email ownership is never verified; the quorum is only as independent as the people |
| **Operator / anyone holding `ADMIN_API_KEY` or the console env** | Vote as *every* signer by changing the `x-actor-email` header; initiate transfers; add/remove signers (after cooling-off); change the threshold; mint API keys (no quorum, no signer check, `custody.service.ts:508-526`); rotate keys; run key backfill and fleet rotation (`keys-admin.controller.ts`) | None: the header is unauthenticated (`custody.controller.ts:41-46`) | **High**: the "quorum" is an application rule, not a cryptographic one (F-20, F-21). Node policy remains the only independent limit |
| **Holder of a tenant API key (integration)** | Submit signing requests; below the policy approval threshold they are signed without any human approval (`sign.service.ts:217-221`; approval rule only for `value > 10 ETH`, `OPA approval_rules.rego:5-12`); choose their own `nonce` (`sign-request.dto.ts:47-50`); choose `country` (`dto:52-54`, used by geo policy `sign.service.ts:153`) | Policy-service rules on `to`/`value`/country/whitelist; tenant velocity cap by tier (`risk.service.ts:20-24`) **[code]** but fails open if Redis errors or is absent (`risk.service.ts:42-45,76-87`) | **High-Med**: policy does not see calldata, so an ERC-20 transfer has `value=0` and bypasses value limits and the approval rule (F-22) |
| **Compromised dependency (gateway or console)** | Run code with the admin key, DB credentials and session secrets. `npm audit` today reports advisories on Next.js, NestJS packages, axios, protobufjs, lodash, js-yaml, nodemailer (see 09) | Lockfiles **[code]**; Dependabot covers the console and bureau but not the openfireblocks api-gateway **[absent]** | Medium-High |
| **Compromised gateway host** | Everything an admin-key holder can do, plus direct calls to the signer, DB and Redis | Node policy | **High** |
| **Compromised DB (gateway)** | Add a signer, lower `threshold`, set `cooling_off_hours` to 0, flip proposal rows to `executed`, edit an approved `approve_transaction` payload (destination/value) before it executes, insert votes | Nodes' own policy; the `UNIQUE (proposal_id, signer_id)` vote key; `FOR UPDATE` row lock in `evaluate()` (`custody.service.ts:282-285`) | **High**: votes are not bound to payload content and nothing is signed (F-24) |
| **Compromised DB (console)** | Read TOTP secrets and per-user `api_key` in clear; edit `users.role`; insert sessions | bcrypt for passwords; `sessions` revocation; JWT still needs the secret | **High** for identity |
| **Compromised Vault/KMS** | n/a (these components keep their secrets in environment variables) | | See asset inventory |

### B.4 STRIDE

| | Threat | Mitigation (file:line) | Status | Residual |
|---|---|---|---|---|
| **S** | Session forgery | JWT HS256 with a 32+ char secret enforced in production (`CON/lib/jwt-secret.ts:33-58`); DB session row required (`auth.ts:98-122`) | **[code]**; the dev fallback secret applies whenever `NODE_ENV != production` (`jwt-secret.ts:60-68`) **[dev-only]** | Low-Med (staging with no `NODE_ENV`) |
| S | Acting as another signer | The console fixes the actor to the logged-in user (`custody-action/route.ts:65`); the gateway checks "active signer, past cooling-off" (`custody.service.ts:86-102`) | **[code]** at the console; **[absent]** at the gateway (header trusted) | **High** (F-20) |
| S | SSO takes over an existing account in another tenant | `findOrCreateSsoUser` returns an existing user by email regardless of tenant, then the session is created for *that user's* tenant (`CON/app/api/auth/sso/callback/route.ts:40-53`, `auth.ts:293-303`) | **[absent]** tenant check; exploitable only if an attacker controls an IdP linked to some tenant (**[unverified]** how tenants are linked) | **High** if tenant SSO linking is self-serve (F-41) |
| S | Account takeover by brute force | bcrypt cost 10; MFA optional; no rate limit or lockout in these routes | **[absent]** | **Medium** (F-43) |
| **T** | Altering an approved transfer | `required` is fixed at proposal creation (`custody.service.ts:160-164`); the payload is plain JSONB with no hash commitment | **[absent]** | **Medium** (F-24) |
| T | Double-signing one approved transfer on retry | `retryTransfer` claims the failed proposal atomically (`custody.service.ts:226-247`) but `executeSigning` does not check whether `requestId` was already signed; `execute()` marks any thrown error `failed` including errors after the signature was stored (`sign.service.ts:315-437`, `custody.service.ts:412-431`) | **[absent]**; **[unverified]** by test | Medium (F-23) |
| T | Nonce collision between concurrent transfers | Per-address in-process queue + `pg_advisory_lock`, row written before unlock (`nonce.service.ts:55-76`, `sign.service.ts:357-398`) | **[tested]** `nonce.service.spec.ts`, `sign.service.spec.ts` (mocked pg) | Low-Med; lock held across a 120 s HTTP call on a pooled connection |
| T | Quorum arithmetic | `required = min(threshold, eligible signers)` (`quorum.ts:8-17`); tally counts only active signers (`custody.service.ts:317-333`) | **[code]**, no tests exist for `custody.service.ts` | Med: removing/cooling signers lowers the quorum automatically |
| T | Proposal marked executed before it is carried out | `evaluate` sets `executed` then calls `execute` after commit (`custody.service.ts:294-313`); a crash between leaves an approved transfer that never signs and cannot be retried (only `failed` can) | **[absent]** | Low-Med (F-33) |
| **R** | Denying an action | Audit events with `actor` (`OFB/database/audit.service.ts`); console `audit_log` | **[code]**; writes are best-effort and DB-resident | Med |
| **I** | Secrets in logs / responses | RPC URL logged (`ethereum.service.ts:46`); plaintext per-user API key returned at login (`login/route.ts:91`); session JWT emailed as a "verification token" (`signup/route.ts:50-64`, `email.ts:36-38`) | **[absent]** | **Medium** (F-26, F-42, F-43) |
| I | Cross-tenant reads | `customer_id` on all gateway reads (`postgres.service.ts:89-109`); console queries filter `tenant_id`; the admin routes take `:customerId` from the URL and trust the admin key | **[code]** | Low-Med; no RLS (`audit-checklist.md`) |
| **D** | Request floods | `@nestjs/throttler` per IP, admin and health exempt (`OFB/app.module.ts:20-25`, `custody.controller.ts:53`); none in the console | **[code]** | Med |
| D | Signer unreachable | Transfer fails with the signer's explanation; proposals can be retried (`custody.service.ts:226-247`) | **[tested]** `keys-backfill.service.spec.ts`, `sign.service.spec.ts` | Low |
| **E** | Role escalation | RBAC matrix (`rbac.ts:25-40`); invitable roles `admin/approver/analyst` only (`invitations.ts:6`); first SSO login defaults to `analyst` (`auth.ts:293-303`) | **[code]**; no tests exist for the console (05) | Med |
| E | An API key as a way around the quorum | Keys issued by `issueApiKey` with no quorum (`custody.service.ts:508-526`) | **[absent]** | **High** (F-21) |
| E | Unauthenticated console routes | See B.3 | **[absent]** | **High** (F-40) |

---

## Component C - Stablecoin gateway (`SGW/src/**`)

### C.1 Assets

Deposit-address keys (and what sits in those addresses), the payout, sweep-gas and operating wallets, the payout/sweep/
treasury ledgers, the FX rate, merchant and admin API keys, the integrity of settlement (what counts as "paid").

### C.2 Trust assumptions

1. One JSON-RPC provider per chain answers truthfully about logs, blocks, balances and fees (`SGW/src/config.ts:70-75`
   defaults to public endpoints "meant as placeholders", `index.ts:192-198`).
2. `NODE_ENV=production` is set. Several protections key off it, and `config.env` defaults to `development`
   (`SGW/src/config.ts:43`, `api-key-auth.ts:189`, `keystore.ts:55-60`). The Dockerfile sets it (`SGW/Dockerfile:28`).
3. Postgres is trusted for amounts, destinations and states: the sweeper and payout worker act on what rows say.
4. A single gateway process runs the workers (no leader election at HEAD; replicas would each run them).
5. The token contracts (USDC, USDT, ZARP, OUSD) behave as plain ERC-20s and are not changed under the gateway.

### C.3 Attackers

| Attacker | What they can do today | What stops them | Residual |
|---|---|---|---|
| **Unauthenticated network caller** | Reach `/healthz` only; everything else needs an API key (`api-key-auth.ts:191-224`) | Production refuses to boot without real admin keys (`api-key-auth.ts:102-130`) **[tested]** (`api-key-auth.test.ts:32-64`) | Rate limit key is the raw `X-Forwarded-For` header with `trustProxy: true`, so it can be spoofed per request (`index.ts:61,64-73`, F-54). `startsWith('/health')` also skips auth for any path beginning with that prefix (`api-key-auth.ts:193`) |
| **Holder of a merchant API key** | Create deposits/x402 payments under its own `merchant_id` and read its own deposits **[tested]** (`api-key-auth.test.ts:90-111,155-164`). **Also:** create, list, approve, reject and submit *any* payout, with `approved_by` and `x-forge-service` chosen by the caller (`routes/payouts.ts:57-210`; no `kind === 'admin'` check, compare `routes/sweeps.ts:30`). Approval gate and idempotency namespace are therefore advisory | Daily cap and per-payout ceiling in the signer (`payout-signer.ts:299-316`) **[code]** | **High** (F-50, F-51): drain the payout float up to the daily cap, and squat the bureau's idempotency keys |
| **Holder of an admin key** | All of the above plus: set the FX rate (bounded 5-100 ZAR/USD, +/-25% unless confirmed), run sweeps and treasury passes, recover "stray" tokens to any address, retry failed sweeps | Reason strings required; `confirm_large_change`; recovery refuses the deposit's own token **by symbol** only (`sweeper.ts:390-393`) | Recovery can be pointed at the deposit's own token by passing its contract address (F-53) |
| **Malicious payer** | Send less, more, late, or other tokens to a deposit address; try to get credit for transfers that are reorged | Credit only from transfers in *final* blocks, cumulative totals, late units recorded separately, wrong tokens ignored (`settlement.ts:19-30,170-188,238-262`) **[code]**; no unit test exercises settlement (05) **[unverified]** by automated test; exercised by `scripts/multi-asset-e2e.cjs` | Reorgs deeper than the confirmation depth are not re-checked (`settlement.ts:22`); L2 "finality" is sequencer-level; one RPC provider |
| **Compromised RPC provider** | Fabricate Transfer logs (credit without payment), hide real ones, lie about balances/fees (gas drip, `canCover`, `balanceOf` at sweep time) | `chainId` is checked at asset verification (`assets.ts:189-196`) **[tested]**; none against lying logs **[absent]** | **Medium-High**: credit decisions rest on one provider (06 Q-18) |
| **Compromised gateway process / host** | Reads the payout, gas and operating keys; unwraps DEKs through the Vault/KMS role and opens every unswept deposit key; reads admin and merchant keys | Tiering limits the *balance present* in hot/warm wallets (`treasury.ts:5-31`), daily caps are in-process | **High** by definition; the exposure is float + warm ceiling + unswept deposits + gas float |
| **Compromised DB (gateway)** | Insert a `payouts` row with an attacker address (status `approved`) and let the worker send it (up to the signer's daily cap); insert a `deposit_sweeps` row (or alter `treasury_address` on a planned one) so the sweeper decrypts a deposit key and sends everything to the attacker (`sweeper.ts:191-197,272,307` read the destination from the row and never compare it with configuration); edit `treasury_transfers` to reset the replenishment cap | Unique indexes (`003`, `005`, `006`); signer re-checks absolute ceiling and 24 h spend, but both come from the same DB (`payout-signer.ts:211-221`); treasury top-up destination is hard-wired in code (`treasury.ts:293`) | **High** (F-52): DB write is equivalent to theft of unswept funds and of the payout float |
| **Compromised Vault/KMS role** | Unwrap any DEK -> any deposit key, given a DB dump | AAD address binding (does not help once the DEK is out) | Same as the DEK's scope: every key wrapped under that wrapping key |
| **Compromised dependency** | Run in the process holding all keys. `npm audit` (production deps) reports `fastify`, `find-my-way`, `fast-uri`, `ws`, `uuid`, `ethers` advisories (09) | Lockfile; Dependabot covers this service | Medium-High |
| **Malicious operator** | As admin plus env/config control: can change `SWEEP_TREASURY_ADDRESS`, caps, `PAYOUT_SIGNER_DAILY_MAX_USD` and redeploy | Nothing enforces dual control over config **[convention]** | Accepted; cold address is a single env var |

### C.4 STRIDE

| | Threat | Mitigation (file:line) | Status | Residual |
|---|---|---|---|---|
| **S** | Impersonating a merchant | API key -> merchant id; ownership check on every by-id route (`api-key-auth.ts:247-259`, `routes/deposits.ts:119-123`, `x402.ts:195-196`) | **[tested]** | Low |
| S | Impersonating the bureau (`x-forge-service`) | None; the header is trusted (`routes/payouts.ts:59`) | **[absent]** | **High** (F-51) |
| S | Dev auth fallback in a mis-labelled environment | `NODE_ENV=production` required for key checks; otherwise any non-empty key is admin (`api-key-auth.ts:189`) and the deposit-key wrapping key is a fixed dev key (`keystore.ts:52-61`) | **[dev-only]** | Med (F-55) |
| **T** | Deposit key moved to another row | AES-GCM AAD address (`keystore.ts:229,257`) | **[tested]** `keystore.test.ts:22-27` | Low |
| T | Altered quote / amount | Units fixed at creation; money in rounds up, out rounds down (`asset-math.ts:54-57`) | **[tested]** `assets.test.ts:8-50` | Low |
| T | Wrong token / decimals credited | On-chain check of code, `symbol()`, `decimals()`, chain id; an asset that fails is unavailable (`assets.ts:176-231`); payout re-checks (`payout-signer.ts:318-331`) | **[tested]** `assets.test.ts:80-170`. USDT also has preset decimals, so it too runs "unverified" when the RPC is down, unlike the file header (`assets.ts:17-19,54`) (F-60) | Low |
| T | Reorg un-credits or double-credits | Cursor only advances over final blocks (`settlement.ts:243-260`); `confirming -> pending` if a non-final transfer vanishes (`settlement.ts:207-216`) | **[code]**; no unit test for settlement | Med: reorgs deeper than the confirmation depth (config `ETH 12, polygon 20, base 10, arbitrum 10`, `config.ts:61-67`) are not handled |
| T | Double payout | Unique `(requested_by, external_id)`; claim `approved -> submitted` before broadcasting; failures are never retried (`payouts.ts:312-322,461-504`, `payout-worker.ts:12-16`) | **[tested]** for validation and broadcaster seam (`payouts.test.ts`); claim logic **[code]**, no DB-backed test | Low-Med; a confirmation-wait error after a successful broadcast marks the payout `failed` although it may land (`payouts.ts:495-503`) (F-56) |
| T | Double sweep / double gas drip | State machine records each hash; the ERC-20 balance is the fence; one sweep per `(deposit, asset)` (`005`, `006`) | **[code]**; sweeper tests cover pure helpers and config only (`sweeper.test.ts`) | Low-Med: the gas-drip hash is written after the send returns (`sweeper.ts:284-285`) (F-67); two replicas would both advance the same row |
| T | Redirecting sweeps | Destination copied to the row at plan time; **not** re-validated at send (`sweeper.ts:191-197,272,307`) | **[absent]** | **High** vs DB write (F-52) |
| **R** | Who approved a payout | `approved_by` is a free-text field from the request (`routes/payouts.ts:146-148`) | **[absent]** | Med (F-50) |
| R | Who changed the FX rate | `set_by` is always the string `admin` (`routes/assets.ts:68`) | **[absent]** | Low-Med |
| **I** | Key disclosure | Envelope encryption; keys opened only inside the sweeper, in memory (`sweeper.ts:20-27`); key errors do not echo key material (`sweeper.ts:82`, `payout-signer.ts:426-431`) | **[tested]** `keystore.test.ts`, `sweeper.test.ts:51-54`, `payout-signer.test.ts:135-148` | Low-Med; keys and DEKs stay in JS heap memory, no zeroisation |
| I | DB connection sniffing | No `ssl` option on the pg pool (`db.ts:36-46`) | **[absent]** | Low-Med (network dependent) |
| **D** | Worker head-of-line blocking | Payouts are sent one at a time inside a pass; `tx.wait` has no timeout (`payout-signer.ts:257-263,363`, `payout-worker.ts:65-80`) | **[absent]** | Med: one stuck transaction stops all payouts |
| D | Unbounded row creation | 300 req/min per (spoofable) forwarded-for value (`index.ts:64-73`); `POST /deposits` has no maximum amount | **[code]** | Low-Med |
| D | Concurrent workers on several replicas | In-process serialisation only (`sweeper.ts:141-161`, `treasury.ts:178-194`, `payout-signer.ts:257-263`); the 24 h payout cap is check-then-send (`payout-signer.ts:308-316`) | **[absent]** at HEAD (leader election is in progress, README section 7) | Med until it lands |
| **E** | Merchant key used on operator routes | Sweeps, treasury, FX use `req.auth.kind !== 'admin'` (`routes/sweeps.ts:30,47,56`, `routes/treasury.ts:31,38,44`, `routes/assets.ts:39`) | **[code]** (no test) ; **payouts routes lack it** | **High** (F-50) |
| E | "Never sweep the deposit's own token to a refund address" | `planRecovery` compares the *symbol* to `d.token` (`sweeper.ts:390-393`) | **[absent]** for contract-address form | Med (F-53) |

---

## Component D - Credit bureau billing and payout paths (`BUR/src/{billing,furnisher-payouts}.ts`, asset routes in `index.ts`)

### D.1 Assets

Prepaid USD balances, top-up receipts, furnisher payout destinations and the amounts owed, the admin key.

### D.2 Trust assumptions

1. The stablecoin gateway's `/x402/verify` answer is truthful and its `received_units` is present (if absent the amount
   check is skipped, `billing.ts:507`).
2. A single bureau process owns the ledger. Balances live in memory and are written behind to Postgres
   (`store.ts:35-105,160-167`); the file says a second replica "would need a real transactional decrement"
   (`billing.ts:101-112`).
3. The gateway keeps `(requested_by, external_id)` unique and returns the original payout on a duplicate; the bureau
   assumes that original is *its own* (`furnisher-payouts.ts:300-329`).

### D.3 Attackers and findings

| Attacker | What they can do today | What stops them | Residual |
|---|---|---|---|
| **Lender/furnisher key holder with `pull_scores`** | Open a top-up, pay once, then send **concurrent** `confirm` calls: each passes the `status === 'confirmed'` check before any of them awaits the gateway, then each credits again (`billing.ts:473-531`). **Verified by experiment**: three concurrent confirms of a $10 receipt produced a $30 balance (F-70). Each confirmed receipt is also a different payment, bounded by what was paid | Own-account scope check (`index.ts:1328-1331`) **[tested]** (`auth.test.ts`); receipt amount compared with `received_units` (`billing.ts:502-513`) | **Medium-High**: free inquiries ($ value limited by concurrency and rate limit 100/min/IP, itself spoofable by `X-Forwarded-For`, `index.ts:358-369`) |
| **Any holder of a gateway API key** (e.g. a merchant) | Create a payout in the gateway under `x-forge-service: agent-credit-bureau` with `external_id = furnisher_<contributorId>_<YYYY-MM>` (public format, `furnisher-payouts.ts:185-187`; seeded ids like `contrib_aave`, `store.ts:477-501`) and their own address *before* the bureau runs; the bureau's later request is "deduplicated", the bureau does not compare payee or amount, marks the furnisher's entries settled, and the attacker's payout is the one that is paid (`furnisher-payouts.ts:300-329`; gateway F-50) | None **[absent]** | **High** (F-51) |
| **Admin key holder (operator)** | Set a furnisher's payout address in one step with no cooling-off or second approver (`index.ts:1859-1900`); credit any balance up to $1,000,000 (`index.ts:1630-1643`, schema `index.ts:328-331`); run settlements | Change is logged with the old address (`index.ts:1877-1889`) **[code]** | Med: single admin credential (and the console holds it with a public default if unset, `CON/lib/forge-services.ts:49-52`) |
| **Compromised bureau process** | Edit balances and receipts in memory; persistence retries three times then logs (`store.ts:91-105`) | None | Med: ledger durability and ordering of write-behind upserts (F-71) |
| **Compromised gateway** | Report any receipt as confirmed with sufficient `received_units` -> credit | None beyond the shared API key | Med |
| **Compromised dependency** | `fastify`, `fast-uri`, `find-my-way`, `viem`/`ws` advisories (09) | Lockfile, Dependabot | Med |

### D.4 STRIDE (condensed)

| | Threat | Mitigation | Status | Residual |
|---|---|---|---|---|
| S | Cross-account billing access | `contributorAccessError` on `/v1/billing/:requestorId/*` (`BUR/src/auth.ts:142-156`, `index.ts:1228-1331`) | **[tested]** | Low |
| T | Double credit of one payment | `receipt.status` gate before the gateway call only | **[absent]** under concurrency; verified | **Medium-High** (F-70) |
| T | Premature settlement spending the idempotency key | `isPeriodClosed` refusal (`furnisher-payouts.ts:69-71,237-245`) | **[tested]** `furnisher-payouts.test.ts` | Low |
| T | Paying in the wrong token | Compares recorded asset with requested (`furnisher-payouts.ts:305-310`) | **[tested]** `multi-asset.test.ts` | Low |
| T | Settling the same period twice | Stable external id; gateway dedup | **[code]**; but see F-51 | Med |
| R | Which entries were paid | `settlementId`, `settledAt` on attribution entries | **[tested]** | Low |
| I | Contributor keys | Hash at rest; redacted in responses (`auth.ts:122-125`) | **[tested]** | Low |
| D | Rate-limit evasion | Key = first `X-Forwarded-For` element (`index.ts:362-363`); Redis-backed if configured | **[code]** | Low-Med |
| E | Dev admin key | Production refuses short/default admin key (`auth.ts:88-104`) | **[tested]** `config-guards.test.ts`; non-production default is public (`auth.ts:70,106`) **[dev-only]** | Low-Med (F-55) |

---

## Cross-cutting residual risks

1. **Two independent custody systems with different trust assumptions.** Strong separation of key material in A does
   nothing for C, where whole keys are in one process.
2. **Several controls depend on `NODE_ENV`/`MPC_ENV` being exactly `production`.** Any staging or ad-hoc deployment that
   omits it silently turns on dev authentication, a public JWT secret, a fixed encryption key and plain-HTTP node traffic.
3. **Authorisation is by shared static secret** in every service (admin key, merchant key, bureau key). No per-person
   credentials reach the gateway for custody actions.
4. **Postgres is trusted to say who may be paid.** Neither the payout nor the sweep nor the governance path re-derives
   authority from anything the database cannot rewrite.
5. **Availability of the signer, Vault/KMS and the single RPC provider** is assumed; there is no tested failure story
   for key-share loss.
