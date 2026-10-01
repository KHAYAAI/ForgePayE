# 09 - Dependency inventory

Evidence base: commit `da11f54`, lockfiles and `go.mod` as committed. Versions in the "resolved" columns are read
from `package-lock.json` / `go.mod`. Vulnerability counts come from `npm audit --omit=dev` run on **2026-10-01** against
the committed lockfiles; the advisory database changes daily, so re-run it on the review tag. **The advisories have not
been triaged** (whether the vulnerable code path is reachable has not been assessed). Go modules were **not scanned**:
`govulncheck` is not installed in the authors' environment.

The working tree contains uncommitted `go.mod`/`go.sum` changes (new AWS S3 SDK modules) from in-progress work; they are
not described here.

## 1. Go - `forgepay/services/openfireblocks/services/mpc-signer` (`go.mod`, Go 1.24)

Direct dependencies (`go.mod:9-20`):

| Module | Version | Used by | Notes |
|---|---|---|---|
| `github.com/bnb-chain/tss-lib/v2` | v2.0.0 | node, tss package | **The cryptographic core.** Threshold ECDSA keygen, signing, resharing. Pinned to a release tag; not forked or vendored; no `replace` directive. Whether v2.0.0 carries mitigations for published attacks on tss-lib-based wallets is a reviewer question (06 Q-1). Transitive: `btcsuite/btcd` (a **2019 pseudo-version**), `btcsuite/btcutil` (2019), `decred/dcrd/dcrec/edwards/v2`, `agl/ed25519` (2017), `ipfs/go-log v0.0.1`, `aead/chacha20*`; several are old and unmaintained |
| `github.com/ethereum/go-ethereum` | v1.14.11 | node, coordinator | Transaction types, signing, hashing, `crypto` (secp256k1). Behind current releases; used as a library only (no node). Review for advisories that affect `core/types` and `crypto` |
| `github.com/aws/aws-sdk-go-v2` v1.47.1, `.../config` v1.33.6, `.../service/kms` v1.61.1 | | node (seal provider) | KMS `GenerateDataKey`/`Decrypt`; credentials via the default chain |
| `github.com/hashicorp/vault/api` | v1.15.0 | signer (`vault.go`, legacy key) | Used only for the legacy KV key. The node's Vault seal provider uses plain `net/http`, not this library (`sealprovider.go:199-331`) |
| `github.com/codenotary/immudb` | v1.9.5 | signer (`audit.go`) | Large dependency tree (gRPC, etc.) linked into the coordinator for a best-effort audit log. Default credentials in code (F-11) |
| `github.com/google/uuid` | v1.6.0 | coordinator | Session ids |
| `github.com/gorilla/mux` | v1.8.1 | signer HTTP API | |
| `github.com/prometheus/client_golang` | v1.12.2 | signer metrics | 2022 release |

Selected indirect dependencies (`go.mod:22-114`, 91 indirect modules in total): `golang.org/x/crypto v0.23.0`,
`golang.org/x/net v0.25.0`, `golang.org/x/sys v0.22.0`, `google.golang.org/grpc v1.57.1`, `google.golang.org/protobuf
v1.34.2`, `github.com/hashicorp/go-retryablehttp v0.7.7`, `github.com/consensys/gnark-crypto v0.12.1`,
`github.com/holiman/uint256 v1.3.1`, `github.com/spf13/viper v1.15.0`. Several `x/*` and `grpc` versions are older than
current releases; scan with `govulncheck` on the review tag.

Which binary links what: `cmd/mpc-node` imports `internal/mpc` (tss-lib, go-ethereum, AWS SDK, uuid); the coordinator
(`main.go`) additionally links `immudb`, `vault/api`, `gorilla/mux`, Prometheus.

Container images: build `golang:1.24-alpine`, runtime `gcr.io/distroless/static-debian12:nonroot`, `USER nonroot`,
static binary (`MPC/Dockerfile`, `Dockerfile.node`). Not built or run by the authors for this package.

Update tooling: **none for Go** (`.github/dependabot.yml` has no `gomod` entry).

## 2. api-gateway - `forgepay/services/openfireblocks/services/api-gateway` (Node 22 base image)

| Package | package.json | Resolved | Notes |
|---|---|---|---|
| `@nestjs/core`, `common`, `platform-express` | `^10.4.15` | 10.4.22 | Framework (v10 line; advisories below) |
| `@nestjs/swagger` | `^8.1.0` | 8.1.1 | Swagger UI is mounted unauthenticated (F-28) |
| `@nestjs/throttler` | `^6.4.0` | 6.5.0 | Per-IP rate limiting |
| `@nestjs/axios`, `axios` | `^3.1.3`, `^1.7.9` | 3.1.3, 1.18.1 | HTTP client to signer, policy service |
| `@temporalio/client` | `^1.11.8` | 1.18.1 | Workflow client |
| `ethers` | `^6.13.5` | 6.17.0 | RPC, tx parsing, formatting; **security-relevant** (provider, nonce, fee data) |
| `pg` | `^8.13.1` | 8.22.0 | **Security-relevant** (advisory locks, all governance state) |
| `ioredis` | `^5.4.2` | 5.11.1 | Velocity limiter |
| `helmet` | `^8.0.0` | 8.2.0 | |
| `class-validator`, `class-transformer` | `^0.14.1`, `^0.5.1` | 0.14.4, 0.5.1 | Request validation (`whitelist`, `forbidNonWhitelisted`) |
| `uuid` | `^11.0.5` | 11.1.1 | |
| `prom-client`, `reflect-metadata`, `rxjs` | | 15.1.3, 0.2.2, 7.8.2 | |

`npm audit --omit=dev` (2026-10-01): **16 advisories (10 high, 5 moderate, 1 low)**, none critical. Direct packages
affected: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@temporalio/client`, `axios`.
Transitive: `@grpc/grpc-js`, `@temporalio/{common,proto}`, `protobufjs`, `multer`, `lodash`, `js-yaml`, `qs`,
`body-parser`, `file-type`. Several fixes are available within semver ranges; some (`@nestjs/*` v12) are major bumps.
Dependabot: **not configured** for this directory.

## 3. Console - `forgepay/apps/platform` (Node 18 base image)

| Package | package.json | Resolved | Notes |
|---|---|---|---|
| `next` | `^14.0.0` | 14.2.35 | **Security-relevant** (auth, middleware, routing). Audit rates the installed range **critical** (fix is a major upgrade) |
| `react`, `react-dom` | `^18.2.0` | 18.3.1 | |
| `jsonwebtoken` | `^9.0.2` | 9.0.3 | Session JWTs (server) |
| `jose` | `^5.9.6` | 5.10.0 | JWT verification in edge middleware |
| `bcryptjs` | `^2.4.3` | 2.4.3 | Password hashing, pure JavaScript, cost 10 (`auth.ts:27-30`); old major |
| `otplib` | `^13.4.1` | 13.4.1 | TOTP |
| `@workos-inc/node` | `^10.10.0` | 10.10.0 | SSO broker |
| `nodemailer` | `^6.9.0` | 6.10.1 | Audit rates installed range **high** |
| `pg` | `^8.11.0` | 8.22.0 | |
| `zod` | `^3.22.0` | 3.25.76 | Input validation |
| `axios` | `^1.6.0` | 1.18.1 | |
| `redis` | `^4.6.0` | 4.7.1 | |
| `qrcode`, `recharts`, `typescript`, `@types/*` | | 1.5.4, 2.15.4, 5.9.3 | `@types/*` are listed under `dependencies` |

`npm audit --omit=dev`: **5 advisories (4 high, 1 critical)**: `next` (critical, several advisories including DoS and
request smuggling in specific configurations), `axios`, `nanoid`, `nodemailer`, `postcss`. Dependabot is configured for
this directory (`.github/dependabot.yml:33-34`).

Container base image: **`node:18-alpine`** (`apps/platform/Dockerfile:1,12`). Node.js 18 reached end of life in April 2025;
verify against the current Node release schedule.

## 4. Stablecoin gateway - `forgepay/services/stablecoin-gateway` (Node 20 base image)

| Package | package.json | Resolved | Notes |
|---|---|---|---|
| `fastify` | `^5.0.0` | 5.10.0 | **Security-relevant**; audit lists advisories for the installed range (schema-validation bypass, `trustProxy` X-Forwarded spoofing - relevant to F-54 - and HTTP/2 trailer DoS) |
| `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` | `^12.0.0`, `^10.0.1`, `^10.2.0` | 12.0.1, 10.1.0, 10.3.0 | Rate limit key spoofable (F-54) |
| `fastify-plugin` | `^5.0.0` | 5.1.0 | |
| `ethers` | `^6.12.1` | 6.16.0 | **Security-relevant**: wallets, key generation (`Wallet.createRandom`), signing, RPC; depends on a vulnerable `ws` range per audit |
| `@aws-sdk/client-kms` | `^3.1143.0` | 3.1143.0 | **Security-relevant**: DEK wrapping |
| `pg` | `^8.12.0` | 8.20.0 | |
| `ioredis` | `^5.3.2` | 5.10.1 | |
| `pino`, `pino-pretty` | `^9.2.0`, `^11.2.1` | 9.14.0, 11.3.0 | Logging (`pino-pretty` is a runtime dependency) |
| `prom-client` | `^15.1.0` | 15.1.3 | |
| `uuid` | `^10.0.0` | 10.0.0 | Audit: moderate advisory (buffer bounds, v3/v5/v6 with `buf`) |

`npm audit --omit=dev`: **6 advisories (4 high, 2 moderate)**: `fastify`, `find-my-way` (HTTP/2 DoS), `fast-uri`, `ws`,
`ethers` (via `ws`), `uuid`. Dependabot is configured. Container base image `node:20-alpine`
(`SGW/Dockerfile:1,9`): Node.js 20's scheduled end of life is April 2026; verify against the Node release schedule.
`NODE_ENV=production` is set in the image (`Dockerfile:28`).

## 5. Credit bureau - `forgepay/services/agent-credit-bureau` (Node 20 base image)

| Package | package.json | Resolved | Notes |
|---|---|---|---|
| `fastify` | `^5.0.0` | 5.9.0 | As above |
| `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` | `^12.0.0`, `^10.0.0`, `^10.0.0` | 12.0.1, 10.1.0, 10.3.0 | |
| `viem` | **`2.21.0` (exact)** | 2.21.0 | Only exactly-pinned dependency in the TypeScript services; audit lists an advisory range ending at 2.49.3 (via `ws`) |
| `zod` | `^3.23.8` | 3.25.76 | |
| `pg`, `ioredis`, `pino`, `dotenv` | | 8.22.0, 5.11.1, 9.14.0, 16.6.1 | |

`npm audit --omit=dev`: **6 advisories (5 high, 1 moderate)**: `fastify`, `@fastify/ajv-compiler`, `find-my-way`,
`fast-uri`, `ws`, `viem`. Dependabot is configured. Base image `node:20-alpine` (`BUR/Dockerfile:1,9`), `NODE_ENV=production`
set (`Dockerfile:20`), `USER node`.

## 6. policy-service (supporting) - `forgepay/services/openfireblocks/services/policy-service`

Go 1.24 with OPA/rego policies and a JSON sanctions list (`sanctions.json`). Not in scope as a lot but it is the
authority for approval and amount limits for component B (F-22). `go.mod` not inventoried here.

## 7. Observations across projects

1. **Version ranges are floating (`^`) everywhere** except `viem` in the bureau. Builds are reproducible only because
   lockfiles are committed and every Dockerfile uses `npm ci` (checked: stablecoin gateway, bureau, api-gateway, console).
   Go modules are pinned by `go.sum`.
2. **Old or unmaintained transitive Go code under the crypto core** (btcd 2019, btcutil 2019, agl/ed25519, ipfs/go-log)
   comes with tss-lib v2.0.0 and cannot be fixed without moving the library.
3. **Base images**: console on Node 18, stablecoin gateway and bureau on Node 20, api-gateway on Node 22. The first two
   are past, or at, their scheduled end of life (see sections 3-5; verify dates).
4. **Dependabot gaps**: no `gomod`, no `forgepay/services/openfireblocks/services/api-gateway`.
5. **No SBOM, no image scan, no `govulncheck`, no secret-scanning job** evidenced.
6. **Libraries that decide custody correctness**: `tss-lib`, `go-ethereum`, `ethers`, `@aws-sdk/client-kms`,
   `hashicorp/vault/api`, `pg`, `fastify`, `next`, `jsonwebtoken`/`jose`, `bcryptjs`, `otplib`. Reviewers should
   consider these first.
7. **Advisory totals today** (production dependencies, untriaged): stablecoin gateway 6, bureau 6, api-gateway 16,
   console 5 (1 critical).
