# Phase 1: Production MVP (Weeks 5-14)

**Goal:** Scale Phase 0 to production with multi-chain, account abstraction, gas sponsorship, and mobile app.

**Duration:** 8-10 weeks  
**Team:** 2-3 engineers  
**Cost:** $120-200K additional  

## Overview

Phase 1 transforms OpenPrivy from a proof-of-concept to a production-ready platform:

```
Phase 0: One wallet → One chain → Testnet only
Phase 1: Multiple wallets → Multiple chains → Mainnet ready
```

### Key Additions

| Feature | Impact | Effort |
|---------|--------|--------|
| **Multi-chain** | Ethereum, Solana, Polygon support | 2 weeks |
| **Account Abstraction** | EIP-4337 smart wallets | 2 weeks |
| **Gas Sponsorship** | Users see $0 fees | 1.5 weeks |
| **Mobile App** | React Native (iOS/Android) | 2.5 weeks |
| **Social Recovery** | Email + trusted friends | 1.5 weeks |
| **DeFi Templates** | Swap, stake integration | 1 week |
| **Monitoring** | Prometheus, Grafana, Sentry | 1 week |
| **Testing & QA** | Integration, E2E, performance | 2 weeks |

## Week-by-Week Breakdown

### Week 5-6: Multi-Chain Support

**Objectives:**
- Add Solana wallet creation & balance
- Add Polygon wallet creation & balance
- Support chain selection in UI

**Backend Changes:**

```typescript
// services/backend/src/modules/blockchain/solana.service.ts
@Injectable()
export class SolanaService {
  private connection: Connection;

  async createWallet(): Promise<{ publicKey: string; secretKey: string }> {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toString(),
      secretKey: Buffer.from(keypair.secretKey).toString('hex'),
    };
  }

  async getBalance(publicKey: string): Promise<number> {
    const pubkey = new PublicKey(publicKey);
    return this.connection.getBalance(pubkey);
  }

  async sendTransaction(
    payer: PublicKey,
    to: PublicKey,
    amount: number,
  ): Promise<string> {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: to,
        lamports: amount,
      }),
    );
    return this.connection.sendTransaction(tx, []);
  }
}
```

**Frontend Changes:**

```typescript
// apps/web/src/hooks/useMultiChain.ts
export const useMultiChain = () => {
  const [selectedChain, setSelectedChain] = useState('ethereum');

  const supportedChains = [
    { id: 'ethereum', name: 'Ethereum', icon: '◇' },
    { id: 'solana', name: 'Solana', icon: '◈' },
    { id: 'polygon', name: 'Polygon', icon: '■' },
  ];

  return { selectedChain, setSelectedChain, supportedChains };
};
```

**Database Update:**

```sql
-- Add chain column to wallets (already exists)
-- Create chain-specific balance cache table
CREATE TABLE chain_balances (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  chain VARCHAR(50),
  balance VARCHAR(100),
  updated_at TIMESTAMPTZ,
  UNIQUE(wallet_id, chain)
);
```

**Testing:**
- [ ] Create Solana wallet
- [ ] Get Solana balance
- [ ] Create Polygon wallet
- [ ] Get Polygon balance
- [ ] Switch between chains in UI

---

### Week 7-8: Account Abstraction (EIP-4337)

**Objective:** Replace EOAs with smart contract wallets

**Smart Contracts:**

```solidity
// contracts/SimpleAccountFactory.sol
pragma solidity ^0.8.0;

import "@eth-infinitism/account-abstraction/interfaces/IEntryPoint.sol";
import "./SimpleAccount.sol";

contract SimpleAccountFactory {
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
    }

    function createAccount(
        address owner,
        uint256 salt
    ) public returns (SimpleAccount ret) {
        ret = new SimpleAccount{salt: bytes32(salt)}(entryPoint, owner);
    }
}

// contracts/SimpleAccount.sol
pragma solidity ^0.8.0;

import "@eth-infinitism/account-abstraction/core/BaseAccount.sol";

contract SimpleAccount is BaseAccount {
    IEntryPoint private immutable _entryPoint;
    address public owner;

    constructor(IEntryPoint anEntryPoint, address _owner) {
        _entryPoint = anEntryPoint;
        owner = _owner;
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override returns (uint256 validationData) {
        // Validate and execute userOp
    }

    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external {
        require(msg.sender == address(_entryPoint), "Only entrypoint");
        (bool success, bytes memory result) = dest.call{value: value}(func);
        require(success, "Execution failed");
    }
}
```

**Backend UserOp Service:**

```typescript
// services/backend/src/modules/account-abstraction/userop.service.ts
@Injectable()
export class UserOpService {
  constructor(
    private ethereumService: EthereumService,
    private pimlicoService: PimlicoService,
  ) {}

  async sendUserOp(
    userId: string,
    walletAddress: string,
    target: string,
    callData: string,
  ): Promise<{ userOpHash: string }> {
    // Build UserOp
    const userOp: UserOperation = {
      sender: walletAddress,
      nonce: await this.getNonce(walletAddress),
      initCode: '0x',
      callData: this.encodeCallData(target, callData),
      accountGasLimits: ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256'],
        [150000, 100000],
      ),
      preVerificationGas: 25000,
      gasFees: ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256'],
        [
          ethers.parseUnits('2', 'gwei'),
          ethers.parseUnits('20', 'gwei'),
        ],
      ),
      paymasterAndData: await this.pimlicoService.getPaymasterData(userOp),
      signature: await this.signUserOp(userId, userOp),
    };

    // Send to bundler
    return this.pimlicoService.sendUserOp(userOp);
  }
}
```

**Frontend:**

```typescript
// apps/web/src/hooks/useAccountAbstraction.ts
export const useAccountAbstraction = () => {
  const sendUserOp = async (target: string, value: string) => {
    const { data } = await api.post('/userop/send', {
      target,
      value,
    });
    return data;
  };

  return { sendUserOp };
};
```

**Testing:**
- [ ] Deploy SimpleAccount contracts to testnet
- [ ] Create smart wallet
- [ ] Fund smart wallet
- [ ] Execute transaction via UserOp
- [ ] Verify paymaster sponsorship
- [ ] Batch multiple UserOps

---

### Week 9: Gas Sponsorship (Pimlico)

**Objective:** Make transactions free for users

**Backend Paymaster Integration:**

```typescript
// services/backend/src/modules/paymaster/pimlico.service.ts
@Injectable()
export class PimlicoService {
  private client: PublicClient;

  async getPaymasterData(userOp: UserOperation): Promise<string> {
    const response = await fetch(
      `${process.env.PIMLICO_ENDPOINT}/ethereum/rpc`,
      {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'pm_sponsorUserOperation',
          params: [userOp, ENTRYPOINT_ADDRESS],
          id: 1,
        }),
      },
    );

    const data = await response.json();
    return data.result.paymasterAndData;
  }

  async sendUserOp(userOp: UserOperation): Promise<string> {
    const response = await fetch(
      `${process.env.PIMLICO_ENDPOINT}/ethereum/rpc`,
      {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_sendUserOperation',
          params: [userOp, ENTRYPOINT_ADDRESS],
          id: 1,
        }),
      },
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }

  async getUserOpReceipt(userOpHash: string): Promise<any> {
    const response = await fetch(
      `${process.env.PIMLICO_ENDPOINT}/ethereum/rpc`,
      {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getUserOperationReceipt',
          params: [userOpHash],
          id: 1,
        }),
      },
    );

    return response.json();
  }
}
```

**Cost Tracking:**

```typescript
// services/backend/src/modules/paymaster/paymaster.service.ts
@Injectable()
export class PaymasterService {
  constructor(
    @InjectRepository(Transaction)
    private txRepository: Repository<Transaction>,
  ) {}

  async trackGasSponsorship(
    txHash: string,
    gasCostWei: string,
  ): Promise<void> {
    await this.txRepository.update(
      { txHash },
      {
        metadata: {
          gasSponsored: true,
          gasCostWei,
        },
      },
    );

    // Log for accounting
    logger.info(`Gas sponsored: ${gasCostWei} wei for ${txHash}`);
  }
}
```

**Frontend Display:**

```typescript
// apps/web/src/components/GasEstimator.tsx
export function GasEstimator({ userOp }: { userOp: UserOperation }) {
  const estimatedGas = calculateGas(userOp);

  return (
    <div className="p-4 bg-green-50 border border-green-200 rounded">
      <p className="text-green-900 font-medium">Gas Sponsored ✓</p>
      <p className="text-green-700 text-sm">You pay $0 gas fees</p>
      <p className="text-green-600 text-xs mt-2">
        OpenPrivy covers: {estimatedGas.toFixed(4)} ETH
      </p>
    </div>
  );
}
```

**Testing:**
- [ ] Gas sponsorship enabled
- [ ] User sees $0 gas
- [ ] Paymaster covers actual gas
- [ ] Track gas costs in DB
- [ ] Monitor paymaster balance
- [ ] Handle insufficient paymaster funds

---

### Week 10: Mobile App (React Native)

**Setup:**

```bash
cd apps/mobile
npx create-expo-app@latest .
npx expo install @supabase/supabase-js ethers @react-navigation/native
```

**Key Screens:**

```typescript
// apps/mobile/src/screens/LoginScreen.tsx
export function LoginScreen({ navigation }: ScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      setBiometricAvailable(compatible);
    })();
  }, []);

  const handleBiometricLogin = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        disableDeviceFallback: false,
      });

      if (result.success) {
        // Get stored email/password from keychain
        const creds = await getKeychainCredentials();
        await login(creds.email, creds.password);
        navigation.replace('Dashboard');
      }
    } catch (error) {
      console.error('Biometric auth failed:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>OpenPrivy</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={styles.button} onPress={() => login(email, password)}>
          <Text style={styles.buttonText}>Sign In</Text>
        </TouchableOpacity>

        {biometricAvailable && (
          <TouchableOpacity style={styles.biometric} onPress={handleBiometricLogin}>
            <Text>Login with Face ID</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}
```

**Wallet Screen:**

```typescript
// apps/mobile/src/screens/WalletScreen.tsx
export function WalletScreen() {
  const { wallet, balance, listWallets } = useWallet();
  const { user } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.label}>Balance</Text>
          <Text style={styles.amount}>{balance} ETH</Text>
          <Text style={styles.address}>{wallet?.address}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionButton}>
            <Text style={styles.actionText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Text style={styles.actionText}>Receive</Text>
          </TouchableOpacity>
        </View>

        <ChainSelector />
        <RecentTransactions />
      </ScrollView>
    </SafeAreaView>
  );
}
```

**Testing:**
- [ ] iOS build & deploy to TestFlight
- [ ] Android build & deploy to Google Play Internal
- [ ] Biometric auth works
- [ ] Balance display works
- [ ] Send/receive flows work
- [ ] Performance <3s load time

---

### Week 11: Social Recovery

**Objective:** Recover wallet if user loses phone

**Database Schema:**

```sql
CREATE TABLE recovery_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  guardian_email VARCHAR(255) NOT NULL,
  confirmed BOOLEAN DEFAULT FALSE,
  threshold INT DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recovery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  guardian_emails TEXT[] NOT NULL,
  confirmations_needed INT DEFAULT 2,
  confirmations_count INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

**Backend Service:**

```typescript
// services/backend/src/modules/recovery/recovery.service.ts
@Injectable()
export class RecoveryService {
  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    private emailService: EmailService,
  ) {}

  async initiateRecovery(walletId: string, guardianEmails: string[]) {
    const wallet = await this.walletRepository.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const request = this.recoveryRepository.create({
      walletId,
      guardianEmails,
      confirmationsNeeded: Math.ceil(guardianEmails.length / 2),
    });

    await this.recoveryRepository.save(request);

    // Send confirmation emails to guardians
    for (const email of guardianEmails) {
      await this.emailService.sendRecoveryRequest(email, wallet.id, request.id);
    }

    return request;
  }

  async confirmRecovery(requestId: string, guardianEmail: string, signature: string) {
    const request = await this.recoveryRepository.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Recovery request not found');

    // Verify signature (prove guardian approved)
    const isValid = await this.verifySignature(guardianEmail, signature);
    if (!isValid) throw new BadRequestException('Invalid signature');

    request.confirmations_count++;

    if (request.confirmations_count >= request.confirmationsNeeded) {
      // Generate new wallet password
      const newPassword = generateRandomPassword();
      await this.emailService.sendNewPassword(request.walletId, newPassword);
      request.status = 'completed';
      request.completed_at = new Date();
    }

    await this.recoveryRepository.save(request);
    return request;
  }
}
```

**Testing:**
- [ ] Initiate recovery with 2 guardians
- [ ] Guardian 1 confirms
- [ ] Guardian 2 confirms
- [ ] Wallet recovered successfully
- [ ] New password sent via email

---

### Week 12: DeFi Integration

**1. Token Swaps (1inch):**

```typescript
// services/backend/src/modules/defi/swap.service.ts
@Injectable()
export class SwapService {
  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string,
    chain: string,
  ) {
    const response = await axios.get(
      `https://api.1inch.io/v5.2/${CHAIN_ID}/quote`,
      {
        params: {
          fromTokenAddress: fromToken,
          toTokenAddress: toToken,
          amount,
        },
      },
    );

    return response.data;
  }

  async executeSwap(userOpId: string, params: SwapParams) {
    const quote = await this.getSwapQuote(
      params.fromToken,
      params.toToken,
      params.amount,
      params.chain,
    );

    // Build UserOp to execute swap
    const userOp = {
      target: SWAP_ROUTER_ADDRESS,
      callData: quote.tx.data,
      value: params.fromToken === NATIVE_TOKEN ? params.amount : '0',
    };

    return await this.userOpService.sendUserOp(userOp);
  }
}
```

**2. Staking (Lido):**

```typescript
// services/backend/src/modules/defi/staking.service.ts
@Injectable()
export class StakingService {
  async stake(userOpId: string, amount: string) {
    const userOp = {
      target: LIDO_ADDRESS,
      callData: encodeFunctionData({
        abi: LIDO_ABI,
        functionName: 'submit',
        args: [REFERRAL_ADDRESS],
      }),
      value: amount,
    };

    return await this.userOpService.sendUserOp(userOp);
  }

  async getStakingRewards(address: string) {
    // Query Lido subgraph for staking balance
    const response = await axios.post('https://api.thegraph.com/subgraphs/name/lidofinance/lido', {
      query: `{
        account(id: "${address.toLowerCase()}") {
          shares
        }
      }`,
    });

    return response.data;
  }
}
```

**Testing:**
- [ ] Get swap quote (1inch API)
- [ ] Execute token swap
- [ ] Get staking rewards (Lido)
- [ ] Verify balance changes

---

### Week 13: Monitoring & Admin

**Prometheus Metrics:**

```typescript
// services/backend/src/modules/monitoring/prometheus.service.ts
@Injectable()
export class PrometheusService {
  private registry = new Registry();

  walletCreations = new Counter({
    name: 'wallet_creations_total',
    help: 'Total wallets created',
    labelNames: ['chain'],
    registers: [this.registry],
  });

  userOpsSubmitted = new Counter({
    name: 'userops_submitted_total',
    help: 'Total UserOps submitted',
    labelNames: ['chain', 'result'],
    registers: [this.registry],
  });

  userOpLatency = new Histogram({
    name: 'userop_latency_seconds',
    help: 'UserOp latency (submission to confirmation)',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });

  gasSponsored = new Counter({
    name: 'gas_sponsored_wei',
    help: 'Total gas sponsored (wei)',
    labelNames: ['chain'],
    registers: [this.registry],
  });

  activeUsers = new Gauge({
    name: 'active_users',
    help: 'Currently active users',
    registers: [this.registry],
  });

  getMetrics() {
    return this.registry.metrics();
  }
}
```

**Grafana Dashboards:**

```yaml
# infrastructure/monitoring/grafana-dashboards/openprivy.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboards
data:
  openprivy.json: |
    {
      "dashboard": {
        "title": "OpenPrivy",
        "panels": [
          {
            "title": "Wallet Creations",
            "targets": [{"expr": "rate(wallet_creations_total[5m])"}]
          },
          {
            "title": "UserOps/Minute",
            "targets": [{"expr": "rate(userops_submitted_total[1m])"}]
          },
          {
            "title": "UserOp Latency (p95)",
            "targets": [{"expr": "histogram_quantile(0.95, userop_latency_seconds)"}]
          },
          {
            "title": "Gas Sponsored",
            "targets": [{"expr": "increase(gas_sponsored_wei[1h])"}]
          }
        ]
      }
    }
```

**Sentry Integration:**

```typescript
// services/backend/src/main.ts
if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });

  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.errorHandler());
}
```

**Testing:**
- [ ] Metrics exported to Prometheus
- [ ] Grafana dashboards display data
- [ ] Sentry captures errors
- [ ] Alerts configured (e.g., if error rate > 1%)

---

### Week 14: Testing & QA

**Integration Tests:**

```typescript
// tests/integration/wallet.spec.ts
describe('Wallet E2E', () => {
  it('should create wallet → sign transaction → broadcast', async () => {
    // 1. Signup
    const signupRes = await request(app.getHttpServer()).post('/auth/signup').send({
      email: 'test@example.com',
      password: 'Password123!',
    });
    const token = signupRes.body.token;

    // 2. Create wallet
    const walletRes = await request(app.getHttpServer())
      .post('/wallet/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ chain: 'ethereum' });
    const walletId = walletRes.body.id;

    // 3. Get balance
    const balanceRes = await request(app.getHttpServer())
      .get(`/wallet/${walletId}/balance`)
      .set('Authorization', `Bearer ${token}`);
    expect(balanceRes.body.balance).toBeDefined();

    // 4. Send transaction
    const txRes = await request(app.getHttpServer())
      .post('/transactions/request')
      .set('Authorization', `Bearer ${token}`)
      .send({
        walletId,
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bE',
        amount: '0.1',
      });
    expect(txRes.body.id).toBeDefined();
  });
});
```

**E2E Tests (Cypress):**

```typescript
// tests/e2e/happy-path.spec.ts
describe('Happy Path', () => {
  it('user can sign up and send transaction', () => {
    cy.visit('http://localhost:3000');
    cy.contains('Sign Up').click();

    // Signup
    cy.get('[name=email]').type('user@example.com');
    cy.get('[name=password]').type('Password123!');
    cy.get('[name=confirmPassword]').type('Password123!');
    cy.get('button[type=submit]').click();

    // Wait for redirect
    cy.contains('Sign In', { timeout: 5000 });

    // Login
    cy.get('[name=email]').type('user@example.com');
    cy.get('[name=password]').type('Password123!');
    cy.get('button[type=submit]').click();

    // Dashboard
    cy.contains('Create Wallet', { timeout: 5000 }).click();
    cy.contains('Balance', { timeout: 5000 });

    // Send transaction
    cy.contains('Send Transaction').click();
    cy.get('[name=to]').type('0x742d35Cc6634C0532925a3b844Bc9e7595f42bE');
    cy.get('[name=amount]').type('0.1');
    cy.get('button[type=submit]').click();

    // Confirm
    cy.contains('Confirm', { timeout: 5000 }).click();
    cy.contains('Transaction submitted', { timeout: 5000 });
  });
});
```

**Performance Tests (k6):**

```javascript
// tests/load/wallet.load.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up
    { duration: '5m', target: 100 },  // Stay at 100
    { duration: '2m', target: 0 },    // Ramp down
  ],
};

export default function () {
  const url = 'http://localhost:3001/wallet/list';
  const params = {
    headers: {
      'Authorization': `Bearer ${__ENV.TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  const res = http.get(url, params);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
```

**Testing Checklist:**
- [ ] Unit tests (>80% coverage)
- [ ] Integration tests (all APIs)
- [ ] E2E tests (happy path + error cases)
- [ ] Performance tests (load testing)
- [ ] Security tests (OWASP Top 10)
- [ ] Browser compatibility (Chrome, Firefox, Safari)
- [ ] Mobile responsiveness
- [ ] Accessibility (WCAG 2.1 AA)

## Deployment (End of Phase 1)

### Staging Environment

```bash
# 1. Deploy to AWS EKS
terraform apply -target=aws_eks_cluster.main

# 2. Deploy using Helm
helm repo add openprivy https://charts.example.com
helm install openprivy openprivy/openprivy -f values.yaml

# 3. Configure monitoring
kubectl apply -f infrastructure/kubernetes/monitoring/

# 4. Run smoke tests
npm run test:smoke:staging

# 5. Load test
k6 run tests/load/wallet.load.js --vus 100 --duration 10m
```

### Production Readiness Checklist

**Infrastructure:**
- [ ] Multi-region setup (primary + failover)
- [ ] Database backup strategy
- [ ] Auto-scaling configured
- [ ] DDoS protection (AWS Shield)
- [ ] CDN configured (CloudFront)
- [ ] SSL/TLS certificates

**Security:**
- [ ] Code audit completed
- [ ] Penetration testing done
- [ ] Vulnerability scanning (SAST/DAST)
- [ ] Secrets management (AWS Secrets Manager)
- [ ] Compliance check (SOC2, GDPR, POPIA)

**Operations:**
- [ ] On-call rotation setup
- [ ] Runbooks documented
- [ ] Alerting configured
- [ ] Incident response plan
- [ ] Disaster recovery plan

**Quality:**
- [ ] 99.5% uptime SLA
- [ ] <500ms API latency p95
- [ ] <3s page load time
- [ ] 0 data loss
- [ ] Full audit trail

## Metrics by End of Phase 1

- **Users:** 5-10K signups
- **Transactions:** 10-50K signed
- **TVL:** $100-500K (if applicable)
- **Uptime:** 99.5%+
- **Error Rate:** <0.5%
- **Gas Sponsored:** $5-50K/month

## Next Steps (Phase 2)

- Fiat on-ramps (ZAR, USD, EUR)
- DeFi dashboard
- NFT support
- DAO governance
- Tokenomics (if applicable)

---

**Review & Approval:**
- [ ] Tech lead sign-off
- [ ] Security team sign-off
- [ ] Product sign-off
- [ ] Legal review (T&C, Privacy)

**Updated:** June 30, 2024
