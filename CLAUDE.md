# ForgePay — Claude Code Guidance

This repo is a **Hyperswitch fork** (payment-engine core) that also serves as the ForgePay monorepo root.

## Repo Layout

- **Root / `crates/`** → Hyperswitch (Rust). Treat like upstream — only modify when integrating ForgePay-specific changes.
- **`forgepay/`** → All ForgePay additions: apps, services, infra, packages, config.

## Active Branch

All development goes on `claude/forgepay-platform-design-gEkgE`. Push there.

## Key Services

| Directory | Language | Purpose |
|---|---|---|
| `crates/router` | Rust | Hyperswitch payment router — core payment API |
| `forgepay/apps/web` | Next.js 14 | Marketing site |
| `forgepay/apps/dashboard` | Next.js 14 | Merchant dashboard (Polar fork) |
| `forgepay/services/unified-router` | TypeScript/Fastify | Webhook normalizer |
| `forgepay/services/mor-layer` | Python FastAPI | MoR, tax, checkout (Polar fork) |
| `forgepay/services/billing-engine` | Java/Kill Bill | Subscriptions & billing |
| `forgepay/services/stablecoin-gateway` | TypeScript | USDC/USDT + x402 |
| `forgepay/services/crypto-gateway` | TypeScript | Crypto payments |

## Development Commands

```bash
# Hyperswitch (payment-engine) — from repo root
cargo build --release
cargo test

# Marketing site
cd forgepay/apps/web && npm run dev

# Unified router
cd forgepay/services/unified-router && npm run dev

# All services via Docker Compose (local dev)
docker compose -f forgepay/infra/k8s/docker-compose.dev.yml up
```

## Design System

Brand colors: Navy `#0A2540`, Cyan `#00F0FF`. Use Tailwind CSS with these as primaries. Font: Inter.

## Architecture Decisions

See `FORGEPAY.md` for full architecture, service communication map, and build priorities.

## Upstream Sync Policy

- Hyperswitch: pin to a specific commit SHA in `forgepay/config/base/pinned-upstreams.yaml`
- When pulling upstream Hyperswitch changes, never touch `forgepay/` directory
- Polar / Kill Bill / ZeroPay / Keagate forks live under `forgepay/services/` as subtrees

## Security Rules

- Never commit API keys, secrets, or credentials
- Never disable PCI vault in Hyperswitch — all card tokenization must go through vault
- Webhook signatures are HMAC-SHA256 — always verify before processing
- All Kubernetes secrets go through Vault or AWS Secrets Manager, not hardcoded in Helm values
