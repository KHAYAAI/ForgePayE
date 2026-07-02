# OpenPrivy: Open-Source Privy Alternative

An open-source embedded wallet and authentication platform for Africa. No seed phrases. No complexity.

**Version:** 0.1.0 (Phase 0 MVP)  
**Status:** 🟡 Development  
**Timeline:** 6 months to production (Phase 0 → Phase 3)

## Overview

OpenPrivy is a consumer-focused web3 wallet that solves the UX problem:
- **No seed phrases** — Embedded wallet with encrypted key storage
- **Email/Social login** — Familiar authentication
- **Gas sponsorship** — Users see $0 fees
- **Account abstraction** — EIP-4337 smart contract wallets
- **Multi-chain** — Ethereum, Solana, Polygon
- **Mobile-first** — React Native app included

Perfect for South African users and globally.

## Architecture

```
Frontend (React/Next.js)
↓
Backend API (NestJS)
↓
Database (PostgreSQL)
↓
Blockchain (ethers.js, Alchemy)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Next.js 14 + TailwindCSS |
| Backend | NestJS + TypeORM |
| Database | PostgreSQL + Supabase Auth |
| Blockchain | ethers.js + Alchemy API |
| Account Abstraction | EIP-4337 + Pimlico Paymaster |
| Monitoring | Sentry + Prometheus + Grafana |
| DevOps | Docker + Kubernetes |

## Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15+
- Supabase account (free tier OK)

### Setup Local Environment

```bash
# Clone repo
git clone https://github.com/khayaai/open-privy.git
cd open-privy

# Copy environment template
cp .env.example .env

# Edit .env with your Supabase/Alchemy keys
vim .env

# Start services
docker-compose up -d

# Install dependencies
npm install

# Run migrations
cd services/backend && npm run build

# Start development servers
npm run dev
```

Visit:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Health check: http://localhost:3001/health

### Key Environment Variables

```bash
# Supabase (required)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGc...

# Blockchain RPC (required)
ETHEREUM_RPC_SEPOLIA=https://sepolia.infura.io/v3/YOUR_KEY
ALCHEMY_API_KEY=your-alchemy-key

# Database (auto-configured for local)
DATABASE_URL=postgresql://app:dev-only@localhost:5432/openprivy

# Optional: Pimlico (Phase 1)
PIMLICO_API_KEY=your-pimlico-key
```

## Project Structure

```
openprivy/
├── apps/
│   ├── web/                    # React/Next.js frontend
│   │   ├── src/
│   │   │   ├── pages/         # Page components
│   │   │   ├── components/    # Reusable components
│   │   │   ├── hooks/         # Custom React hooks
│   │   │   ├── context/       # Context providers
│   │   │   ├── lib/           # Utilities (API, auth)
│   │   │   └── styles/        # TailwindCSS
│   │   └── package.json
│   │
│   └── mobile/                 # React Native (Phase 1)
│
├── services/
│   └── backend/               # NestJS API
│       ├── src/
│       │   ├── modules/       # Feature modules
│       │   │   ├── auth/
│       │   │   ├── wallet/
│       │   │   ├── blockchain/
│       │   │   └── transactions/
│       │   ├── common/        # Shared utilities
│       │   ├── config/        # Configuration
│       │   └── main.ts        # Entry point
│       └── package.json
│
├── infrastructure/
│   ├── docker-compose.yml     # Local development
│   ├── kubernetes/            # K8s manifests (Phase 1)
│   ├── terraform/             # IaC for AWS (Phase 1)
│   └── init-db.sql           # Database schema
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   └── phase-0-checklist.md
│
└── package.json              # Monorepo root
```

## API Endpoints (Phase 0)

### Authentication
```bash
POST   /auth/signup          # Create account
POST   /auth/login           # Login with email/password
GET    /auth/me              # Get current user
POST   /auth/logout          # Logout
```

### Wallet
```bash
POST   /wallet/create        # Create new wallet
GET    /wallet/get           # Get user's wallet
GET    /wallet/list          # List all wallets
GET    /wallet/:id/balance   # Get wallet balance
POST   /wallet/:id/recovery-email  # Set recovery email
```

### Blockchain
```bash
GET    /blockchain/balance/:address     # Get balance
GET    /blockchain/gas-price            # Get current gas price
GET    /blockchain/tx-history/:address  # Get transaction history
GET    /blockchain/tx-receipt/:hash     # Get transaction receipt
```

### Transactions
```bash
POST   /transactions/request      # Create signing request
POST   /transactions/:id/confirm  # Confirm and broadcast
GET    /transactions/history      # Get user's transactions
GET    /transactions/:id          # Get single transaction
```

## Database Schema

### Users
- id (UUID, PK)
- email (unique)
- username
- email_verified
- mfa_enabled
- created_at

### Wallets
- id (UUID, PK)
- user_id (FK)
- address (unique)
- chain ('ethereum', 'solana', 'polygon')
- encrypted_private_key
- recovery_email
- is_active

### Transactions
- id (UUID, PK)
- user_id (FK)
- wallet_id (FK)
- tx_hash
- from_address
- to_address
- amount
- status ('pending', 'confirmed', 'failed')
- created_at

### Audit Logs
- id (UUID, PK)
- user_id (FK)
- event_type
- metadata (JSONB)
- timestamp

## Security Considerations

### Phase 0 (MVP)
- ✅ Private keys encrypted at rest (AES-256-CBC)
- ✅ JWT authentication
- ✅ CORS protection
- ✅ SQL injection prevention (TypeORM)
- ⚠️ Needs code audit before mainnet

### Phase 1 (Production)
- 🔄 Hardware security module (HSM) for key storage
- 🔄 Social recovery (threshold encryption)
- 🔄 WebAuthn/passkeys
- 🔄 MFA support
- 🔄 Penetration testing
- 🔄 Bug bounty program

## Development Commands

```bash
# Start all services
npm run dev

# Build for production
npm run build

# Run tests
npm run test

# Run integration tests
npm run test:integration

# Lint code
npm run lint

# Format code
npm run format

# Clean build artifacts
npm run clean

# Start backend only
cd services/backend && npm run dev

# Start frontend only
cd apps/web && npm run dev
```

## Testing

```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# E2E tests (Phase 1)
npm run test:e2e

# Load tests (Phase 1)
npm run test:load
```

## Deployment

### Local (Development)
```bash
docker-compose up
```

### Kubernetes (Staging/Production - Phase 1)
```bash
kubectl apply -f infrastructure/kubernetes/

# Watch deployment
kubectl get pods -w

# Check logs
kubectl logs -f deployment/openprivy-backend
```

### Terraform (AWS - Phase 1)
```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

## Monitoring

### Health Checks
```bash
# API health
curl http://localhost:3001/health

# Readiness
curl http://localhost:3001/health/ready
```

### Logs
```bash
# Backend logs
docker-compose logs -f backend

# Database logs
docker-compose logs -f postgres
```

### Metrics (Phase 1)
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000

## Roadmap

### Phase 0 (Weeks 1-4) ✅ Current
- ✅ Basic wallet creation (ethers.js)
- ✅ Email/password authentication
- ✅ Balance display
- ✅ Transaction signing (no broadcast yet)
- ✅ Docker dev environment

### Phase 1 (Weeks 5-14)
- [ ] Multi-chain (Solana, Polygon)
- [ ] Account abstraction (EIP-4337)
- [ ] Gas sponsorship (Pimlico)
- [ ] Mobile app (React Native)
- [ ] Social recovery
- [ ] Advanced UI/UX

### Phase 2 (Weeks 15-20)
- [ ] Multi-chain portfolio
- [ ] DeFi integrations (swaps, staking)
- [ ] NFT support
- [ ] Analytics dashboard
- [ ] Referral program

### Phase 3 (Weeks 21-26)
- [ ] South African market launch
- [ ] KYC/AML (if needed)
- [ ] Fiat on/off ramps
- [ ] Security audit
- [ ] Bug bounty program

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Code of Conduct

Please be respectful and constructive. This is a community project.

## License

MIT License - See LICENSE file for details

## Support

- Documentation: `/docs`
- Issues: GitHub Issues
- Discord: [Community Discord] (Coming soon)
- Email: support@openprivy.dev

## Credits

Built with:
- [ethers.js](https://docs.ethers.org/)
- [NestJS](https://nestjs.com/)
- [Next.js](https://nextjs.org/)
- [Supabase](https://supabase.io/)
- [Tailwind CSS](https://tailwindcss.com/)

## Roadmap to Production

**Cost estimate:** $150-300K  
**Timeline:** 6-9 months  
**Team:** 2-3 engineers  

See `/docs/phase-0-checklist.md` and `/docs/architecture.md` for details.
