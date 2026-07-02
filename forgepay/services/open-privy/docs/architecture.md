# OpenPrivy Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    User Applications                         │
│  (Web, Mobile, Third-party Apps)                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ├─────────────────────────────┐
                   │                             │
    ┌──────────────▼──────────┐    ┌────────────▼─────────┐
    │   Frontend (React)      │    │  Mobile (React Native)
    │   - Authentication UI   │    │  - Biometric Auth     │
    │   - Wallet Dashboard    │    │  - Balance Display    │
    │   - Transaction UI      │    │  - Send/Receive       │
    └──────────────┬──────────┘    └────────────┬─────────┘
                   │                             │
                   └─────────────────┬───────────┘
                                     │
                      ┌──────────────▼──────────────┐
                      │     NestJS Backend API      │
                      │  ┌────────────────────────┐ │
                      │  │ Auth Module            │ │
                      │  │ - JWT & Supabase Auth  │ │
                      │  ├────────────────────────┤ │
                      │  │ Wallet Module          │ │
                      │  │ - Create/Get Wallets   │ │
                      │  │ - Balance Lookup       │ │
                      │  ├────────────────────────┤ │
                      │  │ Blockchain Module      │ │
                      │  │ - ethers.js RPC calls  │ │
                      │  │ - Gas estimation       │ │
                      │  ├────────────────────────┤ │
                      │  │ Transaction Module     │ │
                      │  │ - Signing requests     │ │
                      │  │ - Broadcast & tracking │ │
                      │  └────────────────────────┘ │
                      └──────────────┬───────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────▼────────┐  ┌──────────▼───────┐  ┌──────────▼─────────┐
    │   PostgreSQL     │  │  Redis Cache     │  │ Supabase Auth      │
    │   - Users        │  │  - Sessions      │  │ - OAuth Providers  │
    │   - Wallets      │  │  - Rate limits   │  │ - JWT Signing      │
    │   - Transactions │  │  - Temp data     │  │ - User Management  │
    │   - Audit logs   │  │                  │  │                    │
    └──────────────────┘  └──────────────────┘  └────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────▼──────────┐  ┌────────▼────────┐  ┌─────────▼────────┐
    │  Ethereum RPC      │  │  Alchemy API     │  │ Solana RPC (Ph1) │
    │  - Sepolia Testnet │  │  - Balance API   │  │ - Devnet/Mainnet │
    │  - Mainnet (Phase2)│  │  - Tx History    │  │                  │
    │  - Smart Contract  │  │  - Webhooks      │  │                  │
    │    Calls           │  │                  │  │                  │
    └────────────────────┘  └──────────────────┘  └──────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────▼──────────┐  ┌────────▼────────┐  ┌─────────▼────────┐
    │ Pimlico Bundler    │  │  The Graph       │  │ Paymaster        │
    │ (Phase 1)          │  │  (Phase 1)       │  │ (Phase 1)        │
    │ - UserOp Bundling  │  │  - Indexing      │  │ - Gas Sponsorship│
    │ - Relay to Entryp. │  │  - Query Service │  │                  │
    └────────────────────┘  └──────────────────┘  └──────────────────┘
```

## Component Architecture

### 1. Frontend (React/Next.js)

**Responsibilities:**
- User interface for wallet management
- Authentication flows
- Transaction signing UI
- Balance and portfolio display

**Key Directories:**
```
src/
├── pages/              # Next.js pages (routing)
├── components/         # React components
├── hooks/             # Custom React hooks (useAuth, useWallet)
├── context/           # Auth/Wallet state management
├── lib/              # API client, Supabase client
└── styles/           # TailwindCSS styles
```

**State Management:**
- Auth context (user, JWT token)
- Wallet state (address, balance, chain)
- Transaction UI state

### 2. Backend API (NestJS)

**Responsibilities:**
- User authentication & authorization
- Wallet creation & management
- Transaction orchestration
- Blockchain interaction
- Audit logging

**Module Structure:**
```
src/
├── modules/
│   ├── auth/              # Authentication & user management
│   ├── wallet/            # Wallet CRUD & key management
│   ├── blockchain/        # RPC calls & blockchain data
│   ├── transactions/      # Transaction signing & tracking
│   └── account-abstraction/ (Phase 1)
├── common/
│   ├── logger.ts          # Winston logging
│   ├── health.controller  # K8s health checks
│   └── entities/          # Shared data models
├── config/                # Configuration files
└── main.ts               # Application bootstrap
```

**Key Patterns:**
- Service-based architecture
- Repository pattern (TypeORM)
- Dependency injection (NestJS)
- JWT middleware for protected routes

### 3. Database (PostgreSQL)

**Schemas:**
```sql
-- Users (linked to Supabase Auth)
users(id, email, username, email_verified, created_at, ...)

-- Wallets
wallets(id, user_id, address, chain, encrypted_private_key, ...)

-- Transactions
transactions(id, user_id, wallet_id, tx_hash, status, ...)

-- Audit
audit_logs(id, user_id, event_type, metadata, timestamp, ...)
```

**Indexes:**
- user_id (for fast lookups)
- tx_hash (for tracking)
- created_at DESC (for recent queries)

### 4. Blockchain Integration

**Layers:**
```
Frontend (ethers.js Web3 calls)
    ↓
Backend API (centralized key storage)
    ↓
ethers.js (JSON-RPC client)
    ↓
Ethereum/Solana RPC Nodes
    ↓
Alchemy API (balance/history)
```

**Key Services:**
- **EthereumService** - ethers.js wrapper for RPC calls
- **SolanaService** - Solana Web3.js wrapper (Phase 1)
- **AlchemyService** - REST API for balance/history

### 5. Security Architecture

**Key Management (Phase 0):**
```
User Password
    ↓ (Supabase Auth)
JWT Token
    ↓ (Frontend stores in localStorage)
Backend validates JWT
    ↓
Decrypts wallet private key (AES-256-CBC)
    ↓
Signs transaction
    ↓
Returns signed TX (never exposes key)
```

**Phase 1 Improvements:**
```
User Password
    ↓
Supabase Auth (OAuth2)
    ↓
Passwordless (WebAuthn)
    ↓
Social Recovery (Threshold crypto)
    ↓
Hardware Security Module (Prod)
```

## Data Flow

### Wallet Creation Flow
```
1. User clicks "Create Wallet"
2. Frontend POST /wallet/create {chain: 'ethereum'}
3. Backend:
   a. Generate random wallet (ethers.js)
   b. Encrypt private key (AES-256-CBC)
   c. Store in PostgreSQL
   d. Return address only (never key)
4. Frontend displays address & QR code
5. User sets recovery email
```

### Transaction Signing Flow
```
1. User fills TX form (to, amount)
2. Frontend POST /transactions/request {walletId, to, amount}
3. Backend:
   a. Validate wallet ownership
   b. Create TX record (status: pending)
   c. Estimate gas
   d. Return TX ID + unsigned TX
4. Frontend signs locally (ethers.js)
5. Frontend POST /transactions/:id/confirm {signedTx}
6. Backend:
   a. Validate signature
   b. Broadcast via Ethereum RPC
   c. Track TX hash
   d. Return confirmation
7. Frontend polls for status updates
```

### Balance Lookup Flow
```
1. Frontend GET /wallet/:id/balance
2. Backend:
   a. Check PostgreSQL for cached balance
   b. If stale, query Alchemy API
   c. Update cache in Redis
   d. Return formatted balance
3. Frontend displays in ETH (formatted)
```

## Deployment Architecture

### Local Development
```
Docker Compose
├── PostgreSQL (port 5432)
├── Redis (port 6379)
├── Backend (port 3001)
└── Frontend (port 3000)
```

### Staging (Phase 1)
```
AWS EKS (Kubernetes)
├── API Gateway → CloudFront
├── NestJS Pods (autoscaling)
├── RDS PostgreSQL (Multi-AZ)
├── ElastiCache Redis
└── Monitoring (Prometheus, Grafana)
```

### Production (Phase 2)
```
Multi-region setup
├── Primary: AWS us-east-1
├── Secondary: AWS eu-west-1
├── Database: Aurora PostgreSQL (Global DB)
├── CDN: CloudFront
└── DDoS Protection: Shield + WAF
```

## Monitoring & Observability

### Logging (Winston)
```
Level: debug (dev), info (prod)
Format: JSON
Destinations:
  - Console (dev)
  - Files (prod)
  - CloudWatch (AWS)
```

### Metrics (Prometheus) - Phase 1
```
- wallet_creations_total
- transactions_sent_total
- gas_sponsorship_cost_wei
- user_op_latency_seconds
- api_request_duration_seconds
- database_query_duration_seconds
```

### Tracing (Sentry) - Phase 1
```
- Error tracking
- Performance monitoring
- Release tracking
- User sessions
```

## API Design

### Request/Response Format
```json
{
  "data": { /* Response payload */ },
  "error": null,
  "status": 200,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Error Handling
```json
{
  "error": "Wallet not found",
  "status": 404,
  "code": "WALLET_NOT_FOUND",
  "details": {}
}
```

### Authentication
- Header: `Authorization: Bearer {JWT_TOKEN}`
- Valid for 24 hours (configurable)
- Refresh via Supabase (manual re-login)

## Scaling Considerations

### Phase 0 → Phase 1
- **Horizontal scaling:** Multiple NestJS instances behind load balancer
- **Database scaling:** Read replicas for Alchemy API calls
- **Caching:** Redis for frequently accessed data
- **Rate limiting:** Per-user API limits

### Phase 1 → Phase 2
- **Database:** Sharding by user_id (if millions of users)
- **Queue system:** Bull/RabbitMQ for async operations
- **CDN:** CloudFront for static assets
- **Search:** Elasticsearch for transaction history search

### Phase 2 → Phase 3
- **Microservices:** Separate auth, wallet, blockchain services
- **Event-driven:** Kafka for transaction events
- **Multi-region:** Global load balancing
- **Blockchain node:** Run own node for latency

## Security Checklist

- [ ] JWT expiration & rotation
- [ ] CORS configuration (allowlist origins)
- [ ] SQL injection prevention (TypeORM)
- [ ] XSS prevention (React sanitization)
- [ ] CSRF tokens (if needed)
- [ ] Rate limiting (API level)
- [ ] Private key encryption (AES-256)
- [ ] Audit logging (all user actions)
- [ ] HTTPS only (production)
- [ ] Code audit (before mainnet)
- [ ] Penetration testing (Phase 2)
- [ ] Bug bounty program (Phase 3)

## Related Documentation

- `/docs/api.md` - API endpoint reference
- `/docs/phase-0-checklist.md` - Implementation checklist
- `/docs/deployment.md` - Deployment guide (Phase 1)
- `/docs/security.md` - Security best practices (Phase 1)
