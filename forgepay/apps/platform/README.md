# ForgePay Platform

Next.js 14 unified platform with marketing site, authentication, and dashboards.

## Structure

```
forgepay/apps/platform/
├── app/
│   ├── page.tsx                    # Marketing home page
│   ├── faq/page.tsx                # FAQ page
│   ├── case-studies/page.tsx       # Case studies
│   ├── auth/
│   │   ├── signup/page.tsx         # Sign-up form
│   │   ├── login/page.tsx          # Login form
│   │   └── verify-email/page.tsx   # Email verification
│   ├── api/
│   │   ├── auth/
│   │   │   ├── signup/route.ts     # POST /api/auth/signup
│   │   │   └── login/route.ts      # POST /api/auth/login
│   │   └── user/
│   │       └── generate-api-key/   # POST /api/user/generate-api-key
│   ├── dashboard/
│   │   ├── layout.tsx              # Sidebar + nav
│   │   ├── payments/page.tsx       # Payment dashboard
│   │   ├── treasury/page.tsx       # Treasury dashboard
│   │   ├── credit-bureau/page.tsx  # Credit Bureau dashboard
│   │   ├── ops/page.tsx            # Ops monitoring
│   │   └── analytics/page.tsx      # Analytics funnel
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── db.ts                       # PostgreSQL utilities
│   ├── auth.ts                     # JWT + password utilities
│   └── email.ts                    # Email sending (Nodemailer)
├── package.json
├── tsconfig.json
├── next.config.js
└── README.md
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create `.env.local`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/forgepay
JWT_SECRET=your-secret-key
API_BASE_URL=http://localhost:3000
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=user
SMTP_PASS=pass
SMTP_FROM=noreply@forgepay.co.za
```

### 3. Database Setup

```bash
psql -h localhost -U postgres -d forgepay < migrations/001_init.sql
```

**Schema (migrations/001_init.sql):**

```sql
-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key UUID UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions (from Kill Bill)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product VARCHAR(50) NOT NULL,
  plan_name VARCHAR(255) NOT NULL,
  billing_amount NUMERIC(10, 2),
  status VARCHAR(50) DEFAULT 'active',
  kb_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API Keys (audit trail)
CREATE TABLE api_key_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_key UUID,
  new_key UUID,
  action VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Routes

### Marketing (Public)

- `/` — Home page
- `/faq` — FAQ
- `/case-studies` — Case studies

### Auth

- `POST /api/auth/signup` — Sign-up
- `POST /api/auth/login` — Login
- `/auth/signup` — Sign-up form
- `/auth/login` — Login form
- `/auth/logout` — Logout

### Dashboards (Protected)

- `/dashboard/payments` — Payment metrics & transactions
- `/dashboard/treasury` — Netting, OFAC, settlements
- `/dashboard/credit-bureau` — Dual-mode scoring
- `/dashboard/ops` — System health, alerts
- `/dashboard/analytics` — Onboarding funnel, churn, email CTR

### API

- `POST /api/auth/signup` — Create account
- `POST /api/auth/login` — Login
- `POST /api/user/generate-api-key` — Generate new API key (requires auth)

## Authentication

- JWT stored in HTTP-only cookie (`auth-token`)
- Token expires in 7 days
- API key for server-to-server calls

## Email

Email is sent via Nodemailer (async queue via Redis, not yet integrated). For local dev, use MailHog:

```bash
docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

## Database Queries

Example: Get user subscriptions

```typescript
import { query } from '@/lib/db';

const subs = await query(
  `SELECT * FROM subscriptions WHERE customer_id = $1`,
  [userId]
);
```

## Deployment

### Vercel

```bash
vercel deploy
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## Next Steps

1. **Connect to Kill Bill API**
   - Add Kill Bill client in `lib/killbill.ts`
   - Sync subscriptions to dashboards in real-time

2. **Add Chart Library**
   - Install Recharts: `npm install recharts`
   - Replace chart placeholders in `/dashboard/payments`

3. **Email Queue**
   - Integrate Redis async queue
   - Move email sending to background jobs

4. **Stripe/Circle Integration**
   - Add payment provider clients
   - Wire up transaction history to dashboards

5. **Analytics**
   - Connect to PostgreSQL `revenue_events` table
   - Track funnel completion, churn signals

## Support

Email: support@forgepay.co.za
