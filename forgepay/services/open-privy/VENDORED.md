# open-privy in this directory

## What's here

This directory holds two different things that share a folder:

1. **open-privy** — the wallet backend behind FORGE Wallet
   (`services/backend`, `apps/`, `k8s/`, `aws/cloudformation-*`, `test/`,
   and the docs listed below). **Canonical source:**
   https://github.com/KHAYAAI/open-privy, vendored at commit `f1f9234`.
2. **Hyperswitch** (a Rust payment router — `crates/`, `postman/`,
   `cypress-tests/`, the Hyperswitch `.github/` workflows, and so on). Not
   related to open-privy and not used by the Wallet. It was checked in under
   this name; it should move to its own directory.

Treat the open-privy files as a mirror of GitHub. Change them there and
re-vendor, or record any deliberate local change below.

## History

An older, weaker open-privy used to live here (a hand-rolled
`common/crypto/private-key-crypto.ts`; a single guardian approval was enough
to complete recovery; in-memory rate limits; no migrations, no tests for the
key handling). The GitHub version supersedes it entirely — per-user derived
keys with the master key from Secrets Manager, real migrations, a required
M-of-N recovery threshold, Redis-backed rate limits, and security tests. The
old files were removed, not merged: the two were independent rewrites of the
same code, and nothing in the old copy was stronger.

## Local FORGE changes

None to the open-privy files.

## Running it

See `.env.example`. FORGE needs `ENCRYPTION_MASTER_KEY` (base64, 32 bytes) and
`JWT_SECRET` — and the console must be given the same `JWT_SECRET` as
`OPENPRIVY_JWT_SECRET`. Chain balances need `ETHEREUM_RPC_SEPOLIA` /
`ETHEREUM_RPC_POLYGON` pointing at a real node; wallet creation does not.

```sh
cd services/backend
npm install --legacy-peer-deps      # root install fails on a React peer conflict
npm run build && npm run migration:run:prod    # migrations, once per database
node dist/main
```
