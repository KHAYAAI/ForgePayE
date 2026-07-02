# OpenPrivy Security Hardening Guide

## Network Security

### DDoS Protection
```bash
# Enable AWS Shield Advanced (AWS)
aws shield create-subscription

# Configure WAF rules
aws wafv2 create-web-acl \
  --name openprivy-waf \
  --scope CLOUDFRONT \
  --rules file://waf-rules.json

# Rate limiting per IP
100 requests/minute per IP (configured in backend)
1000 requests/minute per authenticated user
```

### VPC Configuration
```yaml
# Kubernetes Network Policy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-network-policy
  namespace: openprivy
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: ingress-nginx
    ports:
    - protocol: TCP
      port: 3001
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: UDP
      port: 53  # DNS
  - to:
    - podSelector: {}
    ports:
    - protocol: TCP
      port: 443  # HTTPS outbound
```

## Application Security

### Input Validation
```typescript
// All inputs validated with class-validator
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(12)
  password: string;

  @IsString()
  @Length(3, 50)
  username: string;
}

// SQL injection prevention via TypeORM parameterized queries
const user = await userRepository.findOne({
  where: { email },  // Parameterized, safe
});

// Never use string concatenation for queries
// ❌ BAD: `SELECT * FROM users WHERE email = '${email}'`
// ✅ GOOD: userRepository.find({ where: { email } })
```

### Authentication Hardening
```typescript
// Multi-factor authentication
- Biometric (Face ID/Fingerprint)
- Time-based OTP (optional)
- Recovery codes (backup)

// JWT Security
- Short expiration (15 minutes)
- Refresh token rotation
- Signing secret 32+ characters
- HS256 for symmetric, RS256 for asymmetric

// Password Requirements
- Minimum 12 characters
- Uppercase, lowercase, numbers, symbols
- No common patterns (123456, qwerty, etc.)
- Breach check against HaveIBeenPwned
```

### CORS & CSRF Protection
```typescript
// CORS: Only allow production domains
CorsModule.register({
  origin: [
    'https://app.openprivy.io',
    'https://openprivy.io',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// CSRF: Token in headers for POST/PUT/DELETE
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const token = req.headers['x-csrf-token'];
    if (!verifyCSRFToken(token, req.session)) {
      return res.status(403).json({ error: 'CSRF token invalid' });
    }
  }
  next();
});
```

### Encryption

#### Data at Rest
```typescript
// Symmetric encryption for sensitive data
const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const algorithm = 'aes-256-cbc';
const iv = crypto.randomBytes(16);

function encrypt(text: string): string {
  const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encrypted: string): string {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Encrypt private keys in database
const encryptedPrivateKey = encrypt(wallet.privateKey);
```

#### Data in Transit
```bash
# TLS 1.3 only
ssl_protocols TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;

# HSTS (6 months)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Certificate pinning (production)
# Pin specific certificate for API subdomain
```

### Secrets Management

```bash
# Use HashiCorp Vault (not environment variables in production)

# Store secrets
vault kv put secret/openprivy/backend \
  jwt_secret="..." \
  encryption_key="..." \
  database_password="..." \
  api_keys="..."

# Rotate secrets monthly
vault write -f auth/approle/role/openprivy/secret-id \
  ttl=2592000  # 30 days

# Audit access
vault audit enable file file_path=/var/log/vault-audit.log
```

### API Security

#### Rate Limiting
```typescript
// Per-IP limiting
const limbrer = new RateLimiterMemory({
  points: 100,  // 100 requests
  duration: 60, // per 60 seconds
});

@UseGuards(ThrottleGuard)
@Controller('api')
export class ApiController {
  @Post('auth/login')
  async login() {
    // Max 5 login attempts per minute
  }
}

// Per-user limiting (authenticated)
const userLimiter = new RateLimiterMemory({
  points: 1000,
  duration: 60,  // 1000 requests/minute
});
```

#### Input Size Limits
```typescript
// Limit request body size
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb' }));

// Limit file uploads
multer({ limits: { fileSize: 10 * 1024 * 1024 } })
```

### Security Headers
```typescript
// Helmet.js for secure headers
import helmet from 'helmet';

app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],  // CSP
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https://api.openprivy.io'],
  },
}));

// Headers applied
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'
```

## Database Security

### PostgreSQL Hardening
```sql
-- Disable unnecessary plugins
-- Revoke public schema access
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO openprivy;

-- Create specific roles
CREATE ROLE backend_user WITH LOGIN PASSWORD 'strong_password';
CREATE ROLE readonly_user WITH LOGIN PASSWORD 'strong_password';

-- Grant minimal permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO backend_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;

-- Enable SSL connections
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'

-- Audit sensitive operations
CREATE EXTENSION pgaudit;
ALTER DATABASE openprivy SET pgaudit.log = 'READ, WRITE, DDL';

-- Row-level security
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_wallets ON wallets 
  FOR SELECT USING (user_id = current_user_id());
```

### Backup Encryption
```bash
# Encrypt backups
pg_dump openprivy | \
  openssl enc -aes-256-cbc -salt -out backup.sql.enc

# Decrypt backup
openssl enc -d -aes-256-cbc -in backup.sql.enc | \
  psql openprivy
```

## Smart Contract Security

### Audit Checklist
- [ ] No reentrancy vulnerabilities
- [ ] No integer overflow/underflow (use OpenZeppelin SafeMath)
- [ ] No unchecked external calls
- [ ] Proper access control on all functions
- [ ] No hardcoded private keys or sensitive data
- [ ] Event logging for all important state changes
- [ ] Gas limit checks for loops
- [ ] Proper error handling and validation

### Example: Safe Call
```solidity
// ✅ Safe pattern
(bool success, bytes memory result) = target.call{value: amount}(data);
require(success, string(result));

// ❌ Unsafe pattern
target.call.value(amount)(data);  // No return value check
```

## Monitoring & Logging

### Sensitive Data Filtering
```typescript
// Never log passwords, tokens, private keys
function sanitizeForLogging(obj: any) {
  const sanitized = { ...obj };
  delete sanitized.password;
  delete sanitized.token;
  delete sanitized.privateKey;
  delete sanitized.apiKey;
  delete sanitized.secret;
  return sanitized;
}

logger.info('User login', sanitizeForLogging(user));
```

### Audit Logging
```typescript
// Log all sensitive operations
async createWallet(userId: string, chain: string) {
  const wallet = await this.walletService.create(userId, chain);
  
  // Audit log
  await this.auditLog.create({
    userId,
    action: 'wallet_created',
    resource: 'wallet',
    resourceId: wallet.id,
    timestamp: new Date(),
    ipAddress: this.request.ip,
    userAgent: this.request.get('user-agent'),
  });
  
  return wallet;
}
```

### Security Scanning

```bash
# SAST (Static Application Security Testing)
npm install -g snyk
snyk test --severity-threshold=high

# Dependency audit
npm audit
npm audit fix

# Container scanning
trivy image openprivy-backend:latest

# OWASP dependency check
dependency-check --project OpenPrivy --scan ./
```

## Incident Response

### Security Incident Checklist
1. [ ] Isolate affected systems
2. [ ] Preserve logs and evidence
3. [ ] Notify security team
4. [ ] Assess scope of compromise
5. [ ] Determine root cause
6. [ ] Implement immediate mitigation
7. [ ] Notify affected users (if needed)
8. [ ] Plan remediation
9. [ ] Post-incident review

### Key Contacts
- Security Team: security@openprivy.io
- Incident Commander: incidents@openprivy.io
- Legal: legal@openprivy.io

## Compliance

### SOC 2 Requirements
- [ ] Access controls and authentication
- [ ] Data encryption (at rest and in transit)
- [ ] Audit logging and monitoring
- [ ] Incident response procedures
- [ ] Business continuity planning
- [ ] Regular security assessments
- [ ] Employee security training

### GDPR Compliance
- [ ] User consent for data processing
- [ ] Data minimization (collect only necessary)
- [ ] Right to deletion (user data purge)
- [ ] Data breach notification (within 72 hours)
- [ ] DPA with third parties
- [ ] Legitimate interest assessments

### Financial Compliance (for USD transfers)
- [ ] AML/KYC procedures
- [ ] Sanctions screening
- [ ] Transaction monitoring
- [ ] Currency conversion tracking
- [ ] Tax compliance (1099 reporting if applicable)

## Regular Security Activities

### Daily
- [ ] Monitor security alerts
- [ ] Review error logs for anomalies
- [ ] Check system uptime/health

### Weekly
- [ ] Review access logs
- [ ] Audit failed login attempts
- [ ] Update threat intelligence

### Monthly
- [ ] Security patch updates
- [ ] Dependency updates
- [ ] Credential rotation (non-root users)
- [ ] Backup restoration test

### Quarterly
- [ ] Full security assessment
- [ ] Penetration testing
- [ ] Access review and revocation
- [ ] Disaster recovery drill

### Annually
- [ ] Full security audit
- [ ] Compliance assessment
- [ ] Third-party penetration test
- [ ] Security training for team

---

**Last Updated:** June 30, 2026  
**Version:** 1.0.0  
**Maintained By:** OpenPrivy Security Team
