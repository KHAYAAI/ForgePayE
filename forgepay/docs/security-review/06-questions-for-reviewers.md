# 06 - Questions for the reviewers

Evidence base: commit `da11f54`. Path abbreviations: see [README.md](README.md). These are the places where the authors
are least sure they are right and most want expert eyes. Each item says where to look, why the authors are uneasy, and
what answer would help. Known defects (F-nn, see [04](04-known-limitations.md)) are not repeated here unless a design
question sits behind them.

Reviewer groups: **[C]** applied cryptography / MPC, **[E]** EVM key management and custody, **[W]** web/API security,
**[X]** cloud/KMS/infrastructure.

---

## Part 1 - Threshold ECDSA and resharing (`MPC/internal/mpc`) [C]

### Q-1. Is `bnb-chain/tss-lib v2.0.0` safe to use, and are we using it safely?

Where: `MPC/go.mod:13` (`tss-lib/v2 v2.0.0`), `node.go:1150-1304`.
Why unsure: tss-lib-based wallets were the subject of published key-extraction work (for example the TSSHOCK and
Alpha-Rays line of attacks and the 2023 "practical key extraction attacks in leading MPC wallets" results). The authors
have not assessed whether the pinned release contains the relevant fixes, which zero-knowledge proofs it verifies
(Paillier modulus, small-factor, range proofs), or which parameter-validation steps are the caller's job.
Wanted: a written statement of which known attacks apply to this exact version and configuration, which checks this
repository must add around the library (e.g. validating `LocalPreParams` of *other* parties, key sizes, share
validation) and whether a different protocol or library is advisable.

### Q-2. Distinct party keys per epoch, and the "two roles, one session" reshare

Where: `cluster.go:101-137` (`PartyIDAt`), `node.go:555-584` (building `oldIDs`/`newIDs`), `node.go:1224-1304`
(`runReshare`), `node.go:944-948` (in-process delivery between a node's own two parties).
Design: the tss "key" (the Shamir x-coordinate) is `new(big.Int).SetBytes(sha256("mpc-party|<node>"[|e<N>]))`; the role
(`@old`/`@new`) only affects the *moniker* used for routing, not the key. A node in both committees runs two
`resharing.LocalParty` objects in one process and exchanges messages between them without a network hop.
Questions:
1. The key is a full 256-bit value that is not reduced modulo the curve order here. Does tss-lib reduce, reject, or
   mis-handle values `>= q` or colliding mod `q`? Can two parties' keys collide mod `q` (probability aside, can an
   adversary choose node ids to cause it)?
2. Is it sound for one physical node to hold the old share at epoch `e` and the new share at `e+1` and run both roles
   in one process (shared RNG state, shared Paillier material, shared memory)? Does that leak anything the protocol
   assumes two parties would not see?
3. Epoch 0 uses the original derivation; later epochs mix `e<N>` into the label. Is the derivation, or the choice to
   make keys public and predictable, a problem for the proofs the library does?
4. When the same nodes are re-used (refresh, `FLEET_REFRESH_SAME`), is "fresh shares, same public key" really
   achieved, i.e. are old and new shares independent?

### Q-3. `BuildLocalSaveDataSubset` and signing with any `t+1` of the holders

Where: `node.go:1188-1217` (`runSign`), `node.go:387-388,465`, `coordinator.go:451-497`.
Why unsure: the node picks `ids = SortedPartiesAt(committee, stored.Epoch, "")` and calls
`keygen.BuildLocalSaveDataSubset(k.Save, ids)`, which panics when the committee does not match; the code recovers the
panic and reports a failure. The authors want to be sure that the subset is built correctly for every `t+1` subset, for
every epoch (including after a threshold change, where `Ks`, `BigXj`, `NTildej`, `PaillierPKs` all change), and that a
mismatch cannot silently produce a wrong-but-accepted result rather than a panic. The coordinator always picks the first
`t+1` reachable holders in cluster order (`coordinator.go:480`), so most subsets are exercised only in tests.
Wanted: confirmation of the invariants this relies on, and whether the panic-recovery hides a class of errors.

### Q-4. The probe digest and testing only one subset

Where: `node.go:429-482` (`probeDigest`, `handleProbe`), `coordinator.go:703-725` (`probeSet := newNodes[:newThreshold+1]`).
Design: before committing a reshare, the first `t_new+1` new members sign `keccak256("forge-mpc-probe|<key>|<epoch>|<nonce>")`
with the *pending* epoch; the coordinator checks the signature recovers the original public key. The probe bypasses the
node's transaction policy.
Questions: (a) Is a domain-separated keccak hash with a coordinator-chosen nonce an adequate guarantee that a probe
signature cannot be turned into a spendable transaction signature (it is a signing oracle on a restricted set of
digests)? (b) Probing a single subset does not show that every other `t+1` subset of the new committee works. Is that
acceptable, or should the commit require several/all subsets? (c) Should the probe also verify that *each* new share
individually matches the public commitments (the code only checks that the combined output recovers the key and that
each new share's `ECDSAPub` equals the original, `node.go:1272-1281`)?

### Q-5. Pre-parameters: reuse, validation and lifetime

Where: `preparams.go:47-114`, `node.go:1154,1249-1260`.
Design: sets of safe primes and a Paillier key are generated in the background (`keygen.GeneratePreParamsWithContext`,
one core), sealed with constant AAD `"preparams"`, and consumed once per keygen or per new share. A reshare gives each
*new* member a fresh set; members that stay in the committee also get a fresh set for the new epoch.
Questions: (1) Is "one set per ceremony per node" enough, or must the Paillier key also change on a schedule?
(2) Are safe-prime generation and `Validate()` (`preparams.go:64`) sufficient on the generating side, and what is
verified about *peers'* Paillier keys? (3) The sealed file is claimed by deleting it before use; a crash after deletion
loses a set (acceptable) but is there a path that reuses one? (4) Old-epoch `LocalPreParams` live inside the old share
until it is retired. Does that matter?

### Q-6. Sealed share storage, the link-not-rename pattern, and what "destroyed" means

Where: `node.go:1124-1141` (`saveKey`), `node.go:615-631` (commit), `node.go:632-645` and `sealmigrate.go:90-99`
(`shred`), `sealedfiles.go:43-74`.
Design: a share is written to `<file>.tmp` with `os.WriteFile` (no `fsync` of file or directory), then `os.Link(tmp,
dest)` fails if `dest` exists, then the tmp is removed. A pending share is promoted by `os.Link(pending, active)` then
`os.Remove(pending)`. "Destroying" an old share overwrites it with zeros, `fsync`s, then unlinks.
Questions:
1. Crash consistency: after a power loss can a node report `keygen_completed`/`reshare_pending` to the coordinator and
   still lose the file? Is an `fsync` of the file and of the directory required before success is reported? What
   happens if both `<id>.e<N>.pending` and `.sealed` exist after a crash between link and remove?
2. Is overwriting with zeros meaningful on journaling or copy-on-write filesystems, SSDs, cloud volumes with snapshots,
   or backups? An old sealed share that survives somewhere still decrypts under the *same* seal key the node keeps using.
   The documentation says old shares are "destroyed" and that rotation protects against an attacker who collected `< t+1`
   old shares. Does that claim survive when old ciphertexts can persist? Would per-epoch share encryption keys (and
   destroying the key rather than the file) give a real guarantee?
3. Predictable `.tmp` names and symlink races inside the data directory (permissions 0700): relevant only to local
   attackers, but please confirm.

### Q-7. Request authentication: replay windows, endpoint binding, lifecycle operations

Where: `wire.go:98-107` (`SignBody`/`VerifyBody`), `node.go:237-261` (`authenticated`), `node.go:786-803`
(`newSession`), `node.go:602-656` (`handleLifecycle`).
Design: the coordinator signs the *raw request body* with ed25519. A request is accepted if the signature verifies,
`ts` is within +/-2 minutes, and the session id is valid. Session ids must be new for ten minutes, held in memory.
Questions:
1. The signature binds neither the URL path nor the recipient node. Bodies for `commit`, `retire` and `abort` share one
   struct (`lifecycleReq`) and `handleLifecycle` does **not** register the session id, so a captured `commit` body can be
   replayed to `/v1/reshare/retire` or `/abort` (same fields) within two minutes, and repeated freely within that
   window. Is this exploitable (it needs the coordinator's mTLS certificate in production, nothing in dev)? What should
   domain separation look like?
2. After a restart the in-memory session set is empty, so a captured sign/keygen/reshare body is replayable for up to two
   minutes. Persist the set, shorten the window, or bind to a per-node nonce?
3. Is ed25519-over-JSON-bytes acceptable given that JSON is parsed after verification and unknown fields are ignored?

### Q-8. The policy engine's rolling-limit ledger and the effective limit across committees

Where: `policy.go:354-452` (`Reserve`, `Release`, `live`, `append`, `loadLedger`), `node.go:394-425`.
Design: each node reserves value when it agrees to sign, releases it if the ceremony fails, and persists every entry
(`fsync`) to `policy-ledger.jsonl`; the window is 24 h / 1 h by wall clock.
Questions: (1) Beyond F-04 and F-05, are there other ways to make a reservation disappear (clock changes, file edits,
restart between reserve and release, release of a session that reserved nothing)? (2) Limits are per node. Because the
coordinator picks different committees, the total a *key* can sign per day can reach `n/(t+1)` times a single node's
limit (e.g. 1.5x for 2-of-3) if the committees alternate. Is that acceptable and is the documentation clear? (3) The ledger
is never compacted, `live()` rebuilds a map per call, and a corrupt line stops the node starting; is that the right
failure mode? (4) Time source: should the ledger use a monotonic or externally anchored clock?

### Q-9. mTLS client verification and transport identity

Where: `tls.go:113-161`, `node.go:181-215,664-674`, `cluster.go:190-198`.
Design: the client sets `InsecureSkipVerify: true` and verifies the server chain itself in `VerifyConnection`
(`DNSName: cs.ServerName`, intermediates from the peer's chain, roots from the CA file, reloaded without restart). A
node's identity is the certificate's CommonName; the client does **not** check that the server certificate's CN equals
the node id it meant to reach. Servers require TLS 1.3 client certificates; `tlsWithCA` for Vault allows TLS 1.2.
Questions: is the hand-written verification equivalent to normal hostname verification for IP and DNS names, are
intermediates and key usages handled, should the client pin the expected node id, and is a private CA with no
revocation acceptable for a custody cluster?

### Q-10. Seal providers: Vault transit, KMS and the in-memory seal key

Where: `sealprovider.go:333-483`, `sealmigrate.go:16-88`, `sealcheck.go:17-83`.
Design: the node generates a random 32-byte key (Vault) or asks KMS `GenerateDataKey` (KMS); Vault gets a payload
`{node, key}` and the node id is checked after unwrap, KMS binds with encryption context `mpc-node=<id>`. The wrapped
file (`seal.key.wrapped`) names the key reference (`KeyRef`) to use for decrypt. The key is unwrapped once at start and
held in memory; the key service is not on the signing path.
Questions: (1) Vault's node binding is enforced client-side after decryption, not by Vault (no `context`/derived key);
is that adequate if several nodes share a Vault or a transit key name? (2) The decrypt path trusts `KeyRef` from the
file: can an attacker with disk write redirect a node to a key they control? (3) Is holding the key in ordinary Go
memory (no `mlock`, no zeroisation, core dumps) acceptable for the threat model? (4) Is unwrap-once-at-start the right
trade against re-unwrapping periodically so a revoked role loses access?

### Q-11. Choice of committee, probing of shares and drift

Where: `coordinator.go:451-497`.
The coordinator always asks the first `t+1` reachable holders in cluster order. Should it randomise or rotate so a
corrupted, truncated or stale share on a rarely used node is detected before it is needed? Is there value in a periodic
"probe all subsets" health check?

---

## Part 2 - Ethereum transaction handling and the custody service [E]

### Q-12. Transaction rebuilding and signature normalisation

Where: `MPC/internal/ethtx/ethtx.go:36-112`, `node.go:378-385`, `node.go:1349-1376` (`finalizeSignature`),
`coordinator.go:536-553`.
Design: every node rebuilds the transaction from JSON fields and hashes it itself; legacy (EIP-155) or dynamic-fee only,
no contract creation; `s` is folded to the low half after the protocol; `v` is found by recovering the public key.
Questions: (1) Negative values and absent range checks (F-05); what other invalid-but-hashable inputs exist (chain id
`<= 0` or large `int`, gas limit 0, huge `data`)? (2) Is folding `s` after the MPC output safe and complete for all
chains in scope? (3) Is rebuild-then-hash enough to claim "a node signs what it can read", given the node's policy sees
`value`, `to`, `data` but not an ABI-decoded view?

### Q-13. Nonce allocation and the per-address lock in the gateway

Where: `OFB/blockchain/nonce.service.ts:55-109`, `OFB/sign/sign.service.ts:315-398`, `OFB/blockchain/tx-poller.service.ts:68-82`.
Design: an in-process promise queue per address plus a session-level `pg_advisory_lock(hashtext('nonce:'+address))` on a
pooled connection; the nonce is chosen inside the lock as `max(rpc pending, 1 + highest in-flight nonce we hold)`; the
signed row is written before the lock is released; the lock is held across a signer call with a 120 s timeout.
Questions: (1) `hashtext` is 32 bits: collisions only serialise, but do they share a namespace with `custody-key:*`
and `tx-poller` locks in a harmful way? (2) What breaks if a connection is lost while a session lock is held, if the
pool is exhausted by waiting transfers, or if PgBouncer transaction pooling is used? (3) A transfer signed but not
persisted (DB error after the signer answered) leaves a valid signature outside the system and the nonce unreserved;
what is the right recovery? (4) Callers can set `nonce` (`sign-request.dto.ts:47-50`): gaps, replacements and the
"failed row gives its nonce back" rule (`nonce.service.ts:84-88`). (5) No fee-bumping and `stuck` rows are never
replaced; is leaving them acceptable?

### Q-14. Is the governance quorum what the console says it is?

Where: `OFB/custody/custody.service.ts:147-432`, `custody.controller.ts:41-54`, `quorum.ts:8-17`,
`OFBDOC/infrastructure/init-custody.sql`.
The vote path checks "active signer, past cooling-off" against a header the caller supplies (F-20). Questions: which
design would you recommend to make approvals non-forgeable by the console and the gateway (per-signer keys,
WebAuthn/hardware keys, signatures over a payload hash, an independent approval service)? Is `required =
min(threshold, eligible)` (F-32) and a 24-hour cooling-off the right defaults? Are there time-of-check/time-of-use
problems between `vote()`'s `eligibleSigner` check and `evaluate()`'s tally (`custody.service.ts:193-217,317-333`)?

---

## Part 3 - Stablecoin gateway [E][W][X]

### Q-15. Envelope encryption and address-binding of deposit keys

Where: `SGW/src/lib/keystore.ts:194-260`, `SGW/src/lib/deposit-open.ts:66-88`, `SGW/src/lib/sweeper.ts:298-304`.
Design: AES-256-GCM per key under a data key (DEK) that is reused for up to one hour or 10 000 keys; AAD is
`deposit-key|<lowercased address>`; the DEK is wrapped by Vault transit or KMS (KMS context constant
`purpose=deposit-keys`, Vault no context); the unwrapped DEK is cached 5 minutes; the sweeper checks that the opened key
derives the row's address.
Questions: (1) Does sharing a DEK across thousands of keys matter against the threat model (a memory read of the DEK
exposes all of them), versus one DEK per key? (2) Is address-only AAD enough (no deposit id, merchant, version, wrap
reference)? Should KMS/Vault bind a per-row context so a stolen *wrapped* DEK cannot be used outside this service?
(3) Plaintext private keys and DEKs live in the Node heap (no zeroisation); realistic? (4) Rotation story for the
wrapping key and for blobs sealed under the legacy no-AAD format (`keystore.ts:236-243`).

### Q-16. The sweeper's gas-drip state machine and its crash windows

Where: `SGW/src/lib/sweeper.ts:163-322`, `005_sweeps.sql`, `006_recovery_and_treasury.sql`.
States: `planned -> gas_sent -> sending -> swept | failed | skipped`; hashes are stored when `sendTransaction`/`transfer`
returns (not before); only the ERC-20 balance and unique indexes stop duplicates; `failed` blocks the deposit until a
person retries.
Questions: (1) Walk the crash windows (F-67): can the machine lose money (not just gas), strand dust, or report a
success that did not happen? (2) A destination read from the row at send time (F-52): is re-deriving it from
configuration the right fix, or should sweeps require a signed plan? (3) With replicas (leader election is being
added), what must change in `advance` so two processes cannot both advance one row? (4) Gas estimation from an address
with no native balance, `maxFee` taken once for both the drip and the transfer, `SWEEP_CONFIRMATIONS = 1`, chains
without EIP-1559, the 130% limit margin, and chain-specific fee quirks (Polygon, Arbitrum) -- anything unsafe?

### Q-17. Treasury caps and the tier design

Where: `SGW/src/lib/treasury.ts:137-147,211-293`, `routes/treasury.ts`.
Design: the operating wallet tops up the payout wallet only to the fixed payout address, within a rolling 24 h USD cap
read from `treasury_transfers`, sends surplus to a fixed cold address, and floors depend on `approved` payouts waiting.
Questions: (1) The queue (`approvedQueue`, `treasury.ts:274-277`) sums approved payouts of an asset regardless of chain;
the hot signer is single-chain. Can inflated approved rows drain the warm wallet up to the cap (a DB or F-50 attacker)?
(2) Caps are enforced by the same process that holds the keys and by a DB the attacker may write: what additional
control (on-chain limits via a smart-contract wallet, a co-signer, HSM policy) would turn "limits" into real limits?
(3) Valuation uses the same FX path as pricing; is a stale or wrong ZAR rate a way to bypass the USD cap?
(4) `cold_sweep` is not rate-limited: acceptable since the destination is fixed?

### Q-18. Settlement finality, reorgs and the single-provider trust model

Where: `SGW/src/lib/settlement.ts:94-262`, `SGW/src/config.ts:61-75`, `SGW/src/lib/assets.ts:176-231`.
Design: poll `getLogs` for `Transfer(to=address)` over blocks at least `N` deep (ETH 12, Polygon 20, Base 10, Arbitrum 10),
persist a cursor and cumulative units, record anything after expiry as `late_units`, never un-credit, revert
`confirming -> pending` if a shallow transfer vanishes. A deposit starts scanning at the block current when it was
opened (`from_block`).
Questions: (1) Are the depths right per chain, particularly L2s (sequencer finality vs L1 finality) and Polygon's
history of deep reorgs, and what should happen when a reorg deeper than `N` removes a credited transfer? (2) One RPC
provider decides what was paid: logs, head, block time. Should settlement require two providers, or a receipt check,
or an on-chain `balanceOf` cross-check? (3) `from_block` from a lagging provider, `getLogs` window failures (limits on
public RPCs), logs with `removed: true`, tokens whose `Transfer` data is not a plain `uint256`, partial payments via
many small transfers, and "credit what arrived, never refund" -- any case where credit can exceed payment? (4) Only
`scripts/multi-asset-e2e.cjs` exercises this module; please review it as if untested.

### Q-19. The FX-rate trust model

Where: `SGW/src/lib/fx.ts`, `routes/assets.ts:36-71`, `deposit-open.ts:37-47`, `routes/payouts.ts:91-108`, `config.ts:84-87`.
Design: USD/ZAR is entered by an admin key; accepted if 5-100, within 25% of the last value unless confirmed, not dated in
the future, and not older than 24 hours when used. A quote is locked when a deposit/x402 payment/payout is created.
Questions: (1) A deposit address lives 48 hours by default (`DEPOSIT_ADDRESS_TTL`, `config.ts:84`) and an approved payout can
wait days, so the locked rate can be days old when value moves. How would you bound that exposure? (2) USDC, USDT and
OUSD are assumed to be exactly 1 USD (OUSD adjustable by env); is there an acceptable depeg control? (3) A single static
admin key can set rates (no identity, `set_by = 'admin'`); what controls would you require for a market-moving input?
(4) A live feed is being added by the same team; please comment on the design it should have (multiple sources, bounds,
deviation alarms, fail-closed behaviour) when it lands.

### Q-20. Authorisation of money-moving routes and idempotency namespaces

Where: `SGW/src/routes/payouts.ts:57-210`, `SGW/src/plugins/api-key-auth.ts`, `BUR/src/furnisher-payouts.ts:185-329`.
F-50 and F-51 describe the gap. The design question: how should the gateway identify *which service* is calling (mTLS,
signed requests, per-service keys with scopes), how should requester and approver be separated, and how should the
bureau verify that a "deduplicated" response refers to *its* payout (payee, amount, asset)?

---

## Part 4 - Web, API and cloud [W][X]

### Q-21. Console authentication, sessions and SSO

Where: `CON/lib/auth.ts`, `CON/middleware.ts`, `CON/app/api/auth/**`, `CON/lib/sso.ts`, `CON/lib/invitations.ts`.
Questions: HS256 JWT with a DB session and per-request role re-read; edge middleware trusting an old role; cookie flags
and CSRF stance (`SameSite=Lax`, no tokens); MFA design (TOTP window, no replay guard, 40-bit backup codes, no re-auth
for enrolment changes); SSO linking and the cross-tenant lookup (F-41); invitation flow design (link returned to the
inviter, no email proof); the absence of throttling (F-43). Which of these would you fix first, and is an external
IdP/AuthKit model preferable to the home-grown one?

### Q-22. The `NODE_ENV` switch

Where: `SGW/src/config.ts:43`, `api-key-auth.ts:102-130,189`, `keystore.ts:52-61`, `CON/lib/jwt-secret.ts:33-68`,
`BUR/src/auth.ts:70-108`, `MPC/internal/mpc/sealprovider.go:82`.
Many protections exist only when an environment variable says "production", and defaults are development-friendly.
Should secure defaults invert (fail closed unless `development` is stated), and what is the safest way to make
staging environments behave like production?

### Q-23. Vault/KMS role design for the signer and the gateway

Where: `OFBDOC/deploy/mpc/vault-policy.example.hcl`, `OFBDOC/deploy/aws/kms-policy.example.json`, `SGW/src/lib/keystore.ts:116-156`.
Please review the example policies and recommend: per-node accounts vs one Vault, KMS key policies and grants, role
separation between "can wrap" and "can unwrap" for the gateway, CloudTrail/Vault audit alarms, and the key-recovery
story (what happens if a wrapping key is deleted or disabled?). The KMS example currently does not fit the node (F-15).

### Q-24. Network exposure and service-to-service authentication

Where: `MPC/main.go:354-373`, `OFB/sign/sign.service.ts:321-350`, `forgepay/infra/helm/stablecoin-gateway/templates/networkpolicy.yaml`.
No credential protects the signer API (F-01). The gateway's NetworkPolicy admits any pod in its namespace. What
authentication and segmentation model do you recommend for signer, gateway, bureau and console (mTLS with SPIFFE
identities, signed requests, mesh policy)?

### Q-25. Audit trail design

Where: `MPC/internal/mpc/audit.go`, `OFB/database/audit.service.ts`, `MPC/audit.go` (immudb), `CON/lib/audit.ts`.
Four independent audit mechanisms, all best-effort, none keyed or externally anchored. What would be required for the
logs to support non-repudiation of a custody action and to detect tampering by a privileged operator?

---

## What the authors would value most if time is limited

1. Q-1, Q-2, Q-3, Q-6 (are the MPC and resharing foundations right?).
2. Q-7, Q-8 and the F-03/F-04/F-05 class (is the node a safe last line of defence?).
3. Q-14, Q-20, Q-24 (who is allowed to cause a signature or a payout, and how is that proven?).
4. Q-15, Q-16, Q-18 (the hot-key rails).
