# 01 - System overview

Evidence base: commit `da11f54` (branch `claude/forgepay-platform-design-gEkgE`). Every `path:line` below refers to that
commit. See [README.md](README.md) for the path abbreviations (`MPC`, `OFB`, `CON`, `SGW`, `BUR`).

## 1. What is in scope, in one page

FORGE holds and moves value in **two separate custody models**. A reviewer should treat them as different systems with
different trust assumptions; nothing in the code reviewed links them (a search of `SGW/src` for the MPC signer URL or
cluster files found nothing).

| | Threshold custody (component A + B) | Hot-key stablecoin rails (component C + D) |
|---|---|---|
| Purpose | Per-workspace ETH-style transfers from a threshold-ECDSA key; governed by a signer quorum in the console | Accept stablecoin payments on one-time addresses, sweep them, pay furnishers, keep a payout float |
| Key material | Shares of a secp256k1 key on separate `mpc-node` processes; no process holds the whole key | Whole private keys in the gateway process: one per deposit address (envelope-encrypted in Postgres), plus the payout key, the sweep gas key and the treasury operating key (env var or mounted file) |
| Authorisation | Console RBAC, quorum proposals/votes, policy service, per-node policy | Static API keys (admin / per-merchant), approval threshold on payouts, in-process caps |
| Code | `MPC/**` (Go), `OFB/{custody,sign,blockchain,auth}/**` (NestJS), `CON/app/api/**`, `CON/lib/*` | `SGW/src/**` (Fastify), `BUR/src/{billing,furnisher-payouts,auth}.ts` + asset routes in `BUR/src/index.ts` |

Outside this package: the Mode 2 on-chain contracts (`forgepay/on-chain/`, see README section 6) need their own
smart-contract audit.

## 2. Component map

```mermaid
flowchart LR
  subgraph Internet
    U[Console user<br/>browser]
    M[Merchant / agent<br/>API key holder]
    P[Payer<br/>on-chain sender]
  end

  subgraph Console["Console (CON, Next.js)"]
    C1["app/api/** routes<br/>JWT cookie session"]
  end

  subgraph OFBsvc["openfireblocks"]
    GW[api-gateway<br/>OFB, NestJS]
    PS[policy-service<br/>OPA, Go]
    SIG[mpc-signer<br/>coordinator, Go<br/>MPC main.go]
    N1[mpc-node 1]
    N2[mpc-node 2]
    N3[mpc-node 3]
  end

  subgraph STB["Stablecoin rails"]
    SGWs[stablecoin-gateway<br/>SGW, Fastify]
    BUR[agent-credit-bureau<br/>BUR, Fastify]
  end

  DB1[(Postgres<br/>customers, custody.*,<br/>signing.*, audit.*)]
  DB2[(Postgres<br/>users, sessions,<br/>invitations, audit_log)]
  DB3[(Postgres<br/>stablecoin_deposits, payouts,<br/>deposit_sweeps, treasury_*, fx_rates)]
  VK[(Vault transit / AWS KMS<br/>seal keys, deposit DEKs)]
  RPC[(EVM JSON-RPC<br/>providers)]
  IMM[(immudb<br/>audit, best effort)]

  U --> C1
  C1 -- "admin key + x-actor-email" --> GW
  M -- "API key (OFB tenant key)" --> GW
  M -- "API key (admin / merchant)" --> SGWs
  BUR -- "API key + x-forge-service header" --> SGWs
  C1 -- "BUREAU_ADMIN_API_KEY" --> BUR
  GW --> PS
  GW -- "HTTP, no credential" --> SIG
  SIG -- "mTLS + ed25519-signed body" --> N1 & N2 & N3
  N1 --|"mTLS + X25519/AES-GCM"| N2
  N2 --|"mTLS + X25519/AES-GCM"| N3
  N1 --|"mTLS + X25519/AES-GCM"| N3
  N1 & N2 & N3 -- "unwrap seal key at start" --> VK
  SGWs -- "wrap/unwrap DEK" --> VK
  GW --> DB1
  C1 --> DB2
  SGWs --> DB3
  BUR --> DB3
  GW --> RPC
  SGWs --> RPC
  P -- "token transfer" --> RPC
  SIG --> IMM
```

Notes on the diagram that matter to a reviewer:

- `api-gateway -> mpc-signer` is plain HTTP with no credential (`OFB/sign/sign.service.ts:321-350`,
  `OFB/custody/keys.service.ts:104-106,165-167`); the signer's own HTTP API has no authentication
  (`MPC/main.go:354-373`). See finding F-01 in [04-known-limitations.md](04-known-limitations.md).
- The coordinator is **not** only an ed25519 key: `MPC/main.go:300-311` always loads a legacy single shared signing
  key (F-02).
- The bureau talks to the stablecoin gateway with one API key and a self-asserted `x-forge-service` header
  (`BUR/src/furnisher-payouts.ts:271-277`).

## 3. Trust boundaries

| # | Boundary | Authentication / protection in code | Notes |
|---|---|---|---|
| TB1 | Internet -> console | `auth-token` JWT cookie (HS256, 7 d) + DB session row; RBAC in `CON/lib/rbac.ts`; edge middleware only guards `/dashboard/*` (`CON/middleware.ts:52-56`) | Each `app/api/**` route must authenticate itself; several do not (F-40) |
| TB2 | Internet / integrators -> `api-gateway` | Tenant API key (SHA-256 hashed at rest, `OFB/customers/customer.service.ts:25-65`); admin routes use one static `ADMIN_API_KEY` (`OFB/auth/admin.guard.ts:16-32`) | |
| TB3 | Console server -> `api-gateway` | The admin key plus an **unauthenticated `x-actor-email` header** naming the person (`CON/lib/openfireblocks.ts:32-50`, `OFB/custody/custody.controller.ts:41-46`) | The quorum is only as strong as this one credential (F-20) |
| TB4 | `api-gateway` -> `mpc-signer` | None (plain HTTP) | F-01 |
| TB5 | `mpc-signer` (coordinator) -> nodes | mTLS (cert CN `coordinator`) **and** ed25519 signature over the request body, 2 min skew, single-use session id (`MPC/internal/mpc/node.go:198-261`, `tls.go:113-132`) | mTLS is optional outside `MPC_ENV=production` (`node.go:129-136,195-197`) |
| TB6 | node <-> node | mTLS (CN must equal sender id, `node.go:664-674`) **and** X25519+HKDF+AES-GCM per message (`wire.go:49-96`) | Static-static ECDH, so no forward secrecy at the message layer |
| TB7 | node -> Vault / KMS | AppRole/token/IAM; only at start-up (`MPC/internal/mpc/sealprovider.go:333-359,436-483`) | Seal key then lives in node memory |
| TB8 | services -> Postgres | Password in env; no TLS option in `SGW/src/lib/db.ts:36-46` | A DB writer can alter payouts, sweeps and proposals (see threat model) |
| TB9 | gateways -> JSON-RPC providers | None; single provider per chain | Settlement and balance checks trust the provider's answers |
| TB10 | `stablecoin-gateway` -> Vault / KMS | Token / AppRole / IAM; DEK cached 5 min in memory (`SGW/src/lib/keystore.ts:204-221,248-255`) | One role unwraps every deposit key's DEK |
| TB11 | bureau -> `stablecoin-gateway` | API key (`x-api-key`) + `x-forge-service` header | Payout idempotency is namespaced by that header (F-51) |
| TB12 | Operators -> every host | Out of code | Domain labels in `cluster.json` are declarations, not proofs (`MPC/internal/mpc/cluster.go:156-163`) |

## 4. Data-flow diagrams

### 4.1 Key generation (per workspace, created on first signing)

```mermaid
sequenceDiagram
  autonumber
  participant GW as api-gateway KeysService.ensureKey
  participant CO as mpc-signer Coordinator.Keygen
  participant N as every mpc-node (n of n)
  participant DB as Postgres custody.keys
  GW->>GW: pg_advisory_lock(custody-key:CUSTOMER)  (keys.service.ts:154)
  GW->>CO: POST /mpc/keys (keyId = key-UUID)  (keys.service.ts:165-167)
  CO->>N: POST /v1/keygen (ed25519-signed body, ts, session uuid) (coordinator.go:263-268)
  N->>N: check cluster threshold, production topology, key id unused (node.go:289-309)
  N->>N: take sealed pre-parameters (safe primes + Paillier key) (node.go:1154, preparams.go:47-71)
  N-->>N: tss-lib keygen rounds, each message X25519+HKDF+AES-GCM, retried over HTTP (node.go:919-1008)
  N->>N: seal share: AES-256-GCM(seal key, aad "key|ID"), write tmp then link() (node.go:1124-1141)
  CO->>N: poll GET /v1/sessions/ID until all "done" (coordinator.go:190-236)
  CO->>CO: all nodes must return the same public key (coordinator.go:274-284)
  CO-->>GW: (address, publicKey, threshold, nodes)
  GW->>DB: INSERT custody.keys (keys.service.ts:177-181)
  GW->>GW: pg_advisory_unlock
```

Trust points: the coordinator learns only the public key. If the gateway cannot write the row after the nodes have
stored shares, the key is orphaned (F-34). Party identities for epoch 0 are `sha256("mpc-party|<node>")` and public
(`MPC/internal/mpc/cluster.go:114-125`).

### 4.2 A signing request, console to chain

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant C as Console /api/forge/custody-action
  participant G as api-gateway (Custody + Sign)
  participant PS as policy-service (OPA)
  participant S as mpc-signer (coordinator)
  participant N as t+1 mpc-nodes
  participant RPC as EVM RPC
  B->>C: POST (action: transfer, to, amountEth)
  C->>C: getCurrentUser (JWT + DB session + current role), RBAC approve:payouts (custody-action/route.ts:34-47)
  C->>G: POST /admin/customers/TENANT/custody/transfers  Bearer ADMIN_KEY, x-actor-email (openfireblocks.ts:92-111)
  G->>G: eligibleSigner(actor) (custody.service.ts:86-102, 480-498)
  G->>PS: evaluate(to, value, chainId, country...)  fail closed (policy.service.ts:33-52)
  G->>G: preflight: chain id, fees, balance check (sign.service.ts:117-125)
  G->>G: velocity counter (Redis, fail-open by default) (risk.service.ts:52-88)
  alt policy says requiresApproval (value above 10 ETH)
    G->>G: INSERT custody.proposals approve_transaction, status pending_approval (sign.service.ts:241-303)
    Note over G: signers vote via the same console path, quorum evaluated in evaluate()/execute() (custody.service.ts:193-432)
  end
  G->>G: withAddressLock: allocate nonce, plan fees (sign.service.ts:331-346, nonce.service.ts:55-91)
  G->>S: POST /sign (tx, keyId, expectedAddress)  (no credential) (sign.service.ts:347-350)
  S->>S: KeyMeta: ask nodes for epoch/threshold/holders, pick first t+1 reachable (coordinator.go:352-497)
  S->>N: POST /v1/sign (signed body) (coordinator.go:508-512)
  N->>N: rebuild tx from fields, hash it, check epoch + address + committee, apply own policy (node.go:354-403)
  N-->>N: tss-lib signing rounds, peer-to-peer
  N->>N: low-S + recover V, must recover the key's public key (node.go:1354-1376)
  S->>S: attach signature, require recovered sender == expected address (coordinator.go:536-548)
  S-->>G: signedTx, hash
  G->>G: INSERT signing.transactions status "broadcasting" BEFORE releasing the lock (sign.service.ts:357-374)
  G->>RPC: eth_sendRawTransaction (sign.service.ts:444-490)
  loop every TX_POLL_INTERVAL_MS (5 s)
    G->>RPC: receipt / head -> confirmed | failed | stuck (tx-poller.service.ts:84-223)
  end
```

### 4.3 A resharing (rotation)

```mermaid
sequenceDiagram
  autonumber
  participant Q as Signer quorum (rotate_key proposal) or operator (rotate-all)
  participant G as api-gateway KeysService.rotate
  participant CO as Coordinator.Reshare
  participant O as old committee (t+1 holders)
  participant NW as new committee
  Q->>G: approved proposal -> rotate(customer, nodes, threshold)  (custody.service.ts:377-385)
  G->>G: advisory lock, POST /mpc/keys/ID/reshare (timeout 12 min) (keys.service.ts:225-241)
  CO->>CO: KeyMeta, abort leftover pending shares of the next epoch (coordinator.go:607-621)
  CO->>CO: every new member reachable and has a spare pre-parameter set (coordinator.go:628-637)
  CO->>O: POST /v1/reshare (oldCommittee, newCommittee, publicKey, epoch)
  CO->>NW: POST /v1/reshare
  O-->>NW: tss-lib resharing: old role contributes share, party keys are per epoch (cluster.go:114-137)
  NW->>NW: each new share must reproduce the original public key, save as ID.eN.pending (node.go:1272-1293)
  CO->>NW: probe: new committee signs keccak("forge-mpc-probe|key|epoch|nonce")  (node.go:429-482, coordinator.go:704-725)
  CO->>NW: commit: link pending -> active, remove pending (node.go:615-631)
  CO->>CO: retireStale: shred every share below the new epoch (node.go:632-645, coordinator.go:784-806)
  G->>G: UPDATE custody.keys SET nodes, threshold, epoch (keys.service.ts:243-246)
```

Known weak spots in this flow are listed in F-03 (retire is destructive), F-07 (partial commit) and F-08.

### 4.4 A deposit settled and swept

```mermaid
sequenceDiagram
  autonumber
  participant Mer as Merchant (API key)
  participant G as stablecoin-gateway
  participant DB as Postgres
  participant KS as Vault / KMS
  participant Pay as Payer
  participant RPC as JSON-RPC
  participant SW as Sweeper (in process)
  participant GasW as Gas wallet
  participant Tre as Treasury / operating address
  Mer->>G: POST /deposits (merchant_id, amount_usd, token, chain) (routes/deposits.ts:48-94)
  G->>G: quote (ceil) with registry + FX (deposit-open.ts:37-47)
  G->>G: ethers.Wallet.createRandom(), AES-256-GCM seal under a shared DEK, AAD = address (deposit-open.ts:71, keystore.ts:224-233)
  G->>KS: wrap DEK (cached up to 1 h / 10k uses) (keystore.ts:207-221)
  G->>DB: INSERT stablecoin_deposits (address, private_key_enc, amount_units, expires_at, from_block)
  Pay->>RPC: ERC-20 transfer to the one-time address
  loop every SETTLEMENT_INTERVAL_MS (10 s)
    G->>RPC: getLogs Transfer(to=address) over blocks deeper than N confirmations (settlement.ts:238-262)
    G->>DB: persist cursor + final units, at least the quoted units -> status confirmed, emit event (settlement.ts:170-188)
  end
  loop every SWEEP_INTERVAL_MS (60 s), only if SWEEP_ENABLED=true
    SW->>DB: confirmed, unswept deposits -> deposit_sweeps(planned), treasury address copied onto the row (sweeper.ts:163-197)
    SW->>RPC: balanceOf, fee data, defer if gas above SWEEP_MAX_GAS_GWEI (sweeper.ts:253-273)
    GasW->>RPC: native-coin drip to the one-time address (sweeper.ts:275-290)
    SW->>KS: unwrap DEK, open deposit key, check derived address == row (sweeper.ts:298-304)
    SW->>RPC: transfer(treasury, whole balance) signed by the deposit key (sweeper.ts:306-313)
    SW->>RPC: return leftover gas (dust) to the gas wallet (sweeper.ts:335-347)
  end
```

### 4.5 A payout sent

```mermaid
sequenceDiagram
  autonumber
  participant B as agent-credit-bureau (admin)
  participant G as stablecoin-gateway /payouts
  participant DB as Postgres payouts
  participant W as Payout worker
  participant S as Erc20PayoutBroadcaster (hot key in process)
  participant RPC as JSON-RPC
  B->>G: POST /payouts (external_id=furnisher_ID_YYYY-MM, payee_address, amount_usd, asset), header x-forge-service (furnisher-payouts.ts:271-292)
  G->>G: requested_by := x-forge-service header (routes/payouts.ts:59), quote with floor rounding (95)
  G->>DB: INSERT ... ON CONFLICT (requested_by, external_id) DO NOTHING (payouts.ts:312-322)
  alt amount_usd at or below PAYOUT_AUTO_APPROVE_MAX_USD (100)
    Note over DB: status approved at creation
  else
    Note over DB: status pending_approval, POST /payouts/:id/approve (approved_by) by anyone with an API key (routes/payouts.ts:146-168)
  end
  loop every PAYOUT_WORKER_INTERVAL_MS (15 s), only with a live signer
    W->>DB: reconcile 'submitted' older than 2 min: no hash -> failed, hash -> ask chain (payout-worker.ts:47-63)
    W->>S: canCover? (token balance + gas) (payout-signer.ts:266-275)
    W->>DB: claim approved -> submitted (conditional UPDATE) (payouts.ts:464-469)
    S->>S: chain match, absolute ceiling, rolling 24 h cap from the ledger, registry re-check (payout-signer.ts:285-333)
    S->>RPC: token.transfer(payee, units)
    S->>DB: record tx_hash immediately (onSent) (payouts.ts:484-486)
    S->>RPC: wait for confirmations (no timeout) (payout-signer.ts:363)
    S->>DB: confirmed (payouts.ts:488-492), any error -> failed, never retried (495-503)
  end
```

### 4.6 Treasury tiers

```mermaid
flowchart LR
  D[One-time deposit addresses<br/>key sealed in Postgres] -- sweep --> O["Operating wallet<br/>(warm, key in process)"]
  O -- "top-up when payout wallet below floor<br/>cap REPLENISH_DAILY_MAX_USD<br/>destination fixed in code" --> H["Payout wallet<br/>(hot, key in process)"]
  O -- "surplus above TREASURY_WARM_MAX_USD<br/>to TREASURY_WARM_TARGET_USD" --> CD["Cold address<br/>(no key held)"]
  H -- "approved payouts<br/>(daily cap PAYOUT_SIGNER_DAILY_MAX_USD)" --> F[Furnishers / payees]
  GW["Sweep gas wallet<br/>(key in process)"] -. "gas drip, dust returned" .-> D
  O -. "native coin for payout wallet gas" .-> H
```

Facts: the cold address is configuration only (`SGW/src/lib/treasury.ts:110-117`); the operating wallet's destination
for top-ups is the payout address hard-wired from the signer (`treasury.ts:293`); nothing enforces that
`SWEEP_TREASURY_ADDRESS` equals the operating wallet's address. All three hot keys, the gas key and every
not-yet-swept deposit key are reachable from one Node process, so the tiers bound the *balance present* in each
place, not what a compromised process could sign.

## 5. Technology and runtime summary

| Service | Language / framework | Notable dependencies | Persistence |
|---|---|---|---|
| `mpc-signer` + `mpc-node` | Go 1.24 | `bnb-chain/tss-lib/v2 v2.0.0`, `go-ethereum v1.14.11`, AWS SDK v2 (KMS), `hashicorp/vault/api`, `immudb v1.9.5` | Node data dir (sealed files, audit.log, policy-ledger.jsonl) |
| `api-gateway` | NestJS 10, Node 22 | `ethers 6`, `pg`, `ioredis`, `@temporalio/client` | Postgres (`customers`, `custody.*`, `signing.*`, `audit.*`), Redis |
| Console | Next.js 14 | `jsonwebtoken`, `bcryptjs`, `otplib`, `@workos-inc/node`, `pg` | Postgres (`users`, `sessions`, `invitations`, `audit_log`, ...) |
| `stablecoin-gateway` | Fastify 5, Node 20 | `ethers 6`, `@aws-sdk/client-kms`, `pg`, `ioredis` | Postgres |
| `agent-credit-bureau` | Fastify 5, Node 20 | `viem 2.21.0`, `zod`, `pg` | Memory first; Postgres write-behind (`BUR/src/store.ts:35-105,160-167`) |

Full version table: [09-dependency-inventory.md](09-dependency-inventory.md).
