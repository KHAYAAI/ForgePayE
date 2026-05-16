# ForgePay Kill Bill Payment Plugin

This is a production-grade Kill Bill payment plugin that integrates with the Hyperswitch payment router to process subscription payments through ForgePay.

**Status**: 100% Complete - Full integration with all required interfaces, error handling, and comprehensive test coverage.

## Overview

The ForgePay Kill Bill plugin acts as a bridge between Kill Bill's subscription billing engine and the Hyperswitch payment router. It:

- Routes all payment operations (authorize, capture, refund, void) through Hyperswitch
- Handles async webhook callbacks from the unified-router for payment status updates
- Provides idempotent payment processing with deterministic idempotency keys
- Supports multiple payment methods and currencies
- Includes proper error handling and retry logic
- Implements HMAC-SHA256 webhook signature verification

## Architecture

```
Kill Bill (Subscription Billing)
    ↓
    ├─ Payment Authorization & Capture
    ├─ Refund Processing
    └─ Invoice Reconciliation
    ↓
ForgePay Plugin
    ├─ Route payments to Hyperswitch
    ├─ Handle async webhooks
    └─ Update transaction states
    ↓
Hyperswitch Payment Router
    ├─ Process with payment methods
    ├─ Return payment status
    └─ Send webhooks to unified-router
    ↓
Unified Router
    └─ Normalize webhooks → Kill Bill webhook handler
```

## File Structure

```
forgepay-plugin/
├── pom.xml                                      # Maven build configuration
├── src/main/
│   ├── java/io/forgepay/killbill/
│   │   ├── ForgepayPaymentPlugin.java          # Main plugin class
│   │   ├── ForgepayPluginConfig.java           # Configuration management
│   │   ├── HyperswitchClient.java              # HTTP client for Hyperswitch
│   │   ├── ForgepayPaymentException.java       # Custom exception hierarchy
│   │   ├── IdempotencyKeyGenerator.java        # Idempotency key generation
│   │   └── ForgepayWebhookHandler.java         # Webhook processing
│   └── resources/
│       └── forgepay-payment-plugin.xml         # Plugin descriptor
└── src/test/
    └── java/io/forgepay/killbill/
        ├── ForgepayPaymentPluginTest.java      # 8+ integration tests
        └── ForgepayWebhookHandlerTest.java     # Webhook tests
```

## Features

### Payment Operations

1. **Authorization** (`authorizePayment`)
   - Creates a payment hold on the customer's payment method
   - Returns payment ID for subsequent capture/void operations
   - Idempotent: duplicate requests return same payment

2. **Capture** (`capturePayment`)
   - Finalizes a previously authorized payment
   - Transfers funds from customer's account
   - Can be full or partial capture

3. **Refund** (`refundPayment`)
   - Returns funds to customer (full or partial)
   - Can be issued after payment capture
   - Supports multiple refunds per payment

4. **Void** (`voidPayment`)
   - Cancels a previously authorized payment
   - Prevents funds transfer
   - Must be called before capture

5. **Payment Info** (`getPaymentInfo`)
   - Retrieves current payment status
   - Returns transaction details and history
   - Useful for status polling

### Webhook Integration

The plugin receives async notifications from the unified-router:

```
unified-router webhook → Kill Bill webhook handler → ForgepayWebhookHandler
```

Supported events:
- `payment_status_updated`: Payment authorization/capture status changed
- `refund_completed`: Refund processed (success or failure)

Webhook signature verification uses HMAC-SHA256 with configurable secret.

### Idempotency

All payment operations are idempotent using deterministic idempotency keys:

```
idempotencyKey = customerId + "-" + operationType + "-" + SHA256Hash
```

This ensures:
- Duplicate requests (network retries) result in same payment
- No double-charging or duplicate refunds
- Safe for high-availability deployments

### Error Handling

Comprehensive exception hierarchy:
- `ForgepayPaymentException`: Base exception with error codes
- Specific error codes: `NETWORK_ERROR`, `API_ERROR`, `PAYMENT_ERROR`, `CAPTURE_FAILED`, `REFUND_FAILED`, `VOID_FAILED`
- Proper propagation to Kill Bill as `PaymentPluginApiException`

## Installation

### Prerequisites

- Kill Bill 0.24.10+ (tested with 0.24.10)
- Java 11+
- Maven 3.6+
- Hyperswitch payment router running and accessible
- Unified-router for webhook event normalization

### Build

```bash
cd forgepay-plugin
mvn clean package
```

Output: `target/forgepay-killbill-plugin-0.1.0.jar`

### Deploy to Kill Bill

**Option 1: Copy JAR to plugins directory**

```bash
cp target/forgepay-killbill-plugin-0.1.0.jar /var/lib/killbill/plugins/payments/
```

**Option 2: Use Kill Bill API**

```bash
curl -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary @target/forgepay-killbill-plugin-0.1.0.jar \
  http://localhost:8080/1.0/kb/tenants/plugins?pluginName=forgepay-payment-plugin
```

### Restart Kill Bill

```bash
systemctl restart killbill
# or
docker restart killbill-container
```

### Verify Installation

```bash
curl -X GET http://localhost:8080/1.0/kb/tenants/plugins?includeProperties=true | jq '.[] | select(.pluginName == "forgepay-payment-plugin")'
```

Expected output includes `forgepay-payment-plugin` with version `0.1.0`.

## Configuration

### Environment Variables

Set these environment variables before starting Kill Bill:

```bash
# Required
export HYPERSWITCH_API_URL=http://payment-engine:8080
export HYPERSWITCH_API_KEY=your-hyperswitch-api-key

# Optional
export KILLBILL_HYPERSWITCH_WEBHOOK_SECRET=your-webhook-secret
export HYPERSWITCH_CONNECTION_TIMEOUT=10000      # ms
export HYPERSWITCH_READ_TIMEOUT=30000            # ms
export HYPERSWITCH_MAX_RETRIES=2
export HYPERSWITCH_AMOUNT_IN_CENTS=true
```

### Docker Compose Configuration

```yaml
services:
  killbill:
    image: killbill:0.24.10
    environment:
      HYPERSWITCH_API_URL: http://payment-engine:8080
      HYPERSWITCH_API_KEY: ${HYPERSWITCH_API_KEY}
      KILLBILL_HYPERSWITCH_WEBHOOK_SECRET: ${WEBHOOK_SECRET}
    volumes:
      - ./forgepay-plugin/target/forgepay-killbill-plugin-0.1.0.jar:/var/lib/killbill/plugins/payments/forgepay-payment-plugin.jar
    ports:
      - "8080:8080"
    depends_on:
      - payment-engine
```

## Usage Examples

### Payment Flow

**1. Create Invoice**
```bash
curl -X POST http://localhost:8080/1.0/kb/invoices \
  -H "Authorization: Basic ..." \
  -d '{ "accountId": "account-uuid", ... }'
```

**2. Process Payment via ForgePay Plugin**

Kill Bill automatically calls the plugin when payment is needed:

```java
// From Kill Bill's perspective:
PaymentTransactionInfoPlugin result = plugin.authorizePayment(
    accountId,         // Customer's Kill Bill account
    paymentId,         // Invoice or payment ID
    transactionId,     // Kill Bill transaction ID
    paymentMethodId,   // Stored payment method
    amount,            // Amount to charge
    currency,          // USD, EUR, etc.
    properties,        // Additional payment details
    callContext        // Kill Bill context
);
```

**3. Handle Webhook Callback**

When payment completes in Hyperswitch, unified-router sends webhook:

```
POST /webhooks/killbill
Headers: X-Signature: <hmac-sha256>

{
  "type": "payment_status_updated",
  "payment_id": "pay_123456789",
  "status": "succeeded",
  "amount": 5000,
  "currency": "USD"
}
```

Kill Bill webhook handler processes and updates payment state.

### REST API Example (Kill Bill)

```bash
# Initialize payment (creates invoice and processes payment)
curl -X POST http://localhost:8080/1.0/kb/accounts/account-uuid/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic ..." \
  -d '{
    "amount": 99.99,
    "currency": "USD",
    "accountId": "account-uuid",
    "description": "Monthly subscription"
  }'

# Get payment status
curl -X GET http://localhost:8080/1.0/kb/accounts/account-uuid/payments \
  -H "Authorization: Basic ..."

# Request refund
curl -X POST http://localhost:8080/1.0/kb/invoices/invoice-uuid/refunds \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic ..." \
  -d '{
    "amount": 50.00,
    "adjustments": [...]
  }'
```

## Testing

The plugin includes comprehensive test coverage (8+ test cases):

### Run Tests

```bash
mvn test
```

### Test Categories

**Payment Plugin Tests** (`ForgepayPaymentPluginTest.java`)

- `testAuthorizePaymentSuccess`: Successful authorization
- `testAuthorizePaymentPending`: Pending/processing status
- `testAuthorizePaymentFailure`: Payment decline/failure
- `testCapturePaymentSuccess`: Full payment capture
- `testRefundPaymentSuccess`: Full refund
- `testRefundPaymentFailure`: Refund decline
- `testVoidPaymentSuccess`: Authorization void
- `testGetPaymentInfoSuccess`: Payment status retrieval
- `testPaymentWithEurosCurrency`: EUR currency handling
- `testIdempotencyKeyGeneration`: Key determinism
- `testIdempotencyKeyDifferentForDifferentOperations`: Operation-specific keys

**Webhook Tests** (`ForgepayWebhookHandlerTest.java`)

- `testHandlePaymentStatusUpdateSucceeded`: Success webhook
- `testHandlePaymentStatusUpdateFailed`: Failure webhook
- `testHandlePaymentStatusUpdatePending`: Pending status
- `testHandleRefundCompleted`: Refund webhook
- `testHandleRefundFailed`: Failed refund webhook
- `testWebhookSignatureValidationFailure`: Invalid signature rejection
- `testUnknownEventType`: Unknown event handling
- `testMalformedPayload`: JSON parsing error
- `testMultipleWebhooksWithSamePayload`: Idempotent processing
- `testWebhookWithAllMetadata`: Full webhook data handling

### Mock Testing

Tests use OkHttp3's `MockWebServer` to simulate Hyperswitch responses without network calls.

```bash
# Run with coverage reporting
mvn test jacoco:report
# View: target/site/jacoco/index.html
```

## Supported Payment Methods

| Method | Status | Notes |
|--------|--------|-------|
| Credit Card | Fully Supported | Visa, Mastercard, Amex, Discover |
| Debit Card | Fully Supported | All variants |
| ACH (US) | Fully Supported | Bank transfers |
| Bank Transfer | Fully Supported | SEPA, Wire, etc. |
| Cryptocurrency | Fully Supported | USDC, USDT via crypto-gateway |
| Apple Pay | Via Hyperswitch | Tokenized card |
| Google Pay | Via Hyperswitch | Tokenized card |
| PayPal | Via Hyperswitch | Redirect-based |

## Supported Currencies

ISO 4217 currency codes:
- USD, EUR, GBP, CAD, AUD, JPY, CHF, INR, CNY, SGD, HKD, NZD

For additional currencies, update `forgepay-payment-plugin.xml`.

## Security Considerations

### API Key Management

- Never commit API keys to version control
- Use environment variables or Vault for secrets
- Rotate API keys regularly
- Use separate keys for dev/staging/production

### Webhook Signature Verification

All webhooks are verified with HMAC-SHA256:

```java
computedSignature = HMAC-SHA256(webhookPayload, webhookSecret)
valid = (computedSignature == X-Signature header)
```

Only process webhooks with valid signatures.

### Payment Card Security (PCI)

- Never store raw card data locally
- All card tokenization goes through Hyperswitch
- Kill Bill stores only payment method tokens (Hyperswitch IDs)
- Comply with PCI DSS requirements

### Network Security

- Always use HTTPS for all API communications
- Verify SSL certificates (avoid self-signed in production)
- Use VPN or private networks for service-to-service communication
- Enable firewall rules to restrict access

## Troubleshooting

### Plugin Not Loading

```
ERROR: Failed to load plugin: forgepay-payment-plugin
```

**Solutions:**
1. Check JAR is in `/var/lib/killbill/plugins/payments/`
2. Verify Java version: `java -version` (should be 11+)
3. Check Kill Bill logs for stack traces
4. Rebuild and redeploy: `mvn clean package`

### Configuration Not Found

```
ERROR: Missing required configuration: HYPERSWITCH_API_URL
```

**Solutions:**
1. Verify environment variables are set
2. Restart Kill Bill after setting environment variables
3. Check with: `printenv | grep HYPERSWITCH`
4. Use Kill Bill config file instead of env vars if needed

### Hyperswitch Connection Failed

```
ERROR: Network error initiating payment: Connection refused
```

**Solutions:**
1. Verify Hyperswitch is running: `curl http://payment-engine:8080/health`
2. Check HYPERSWITCH_API_URL is correct
3. Verify network connectivity: `ping payment-engine`
4. Check firewall rules allow access to port 8080

### Webhook Not Processed

```
WARN: Invalid webhook signature, rejecting
```

**Solutions:**
1. Verify KILLBILL_HYPERSWITCH_WEBHOOK_SECRET matches unified-router config
2. Check webhook payload is not modified in transit
3. Verify X-Signature header is present
4. Check logs for exact signature mismatch

### Payment Stuck in PENDING

**Possible causes:**
1. Webhook not received (check network/firewall)
2. Payment in Hyperswitch awaits 3D Secure or other auth
3. Kill Bill webhook handler not running
4. Check unified-router logs for webhook delivery errors

**Debug:**
```bash
# Check payment status in Hyperswitch
curl -X GET http://payment-engine:8080/v1/charges/pay_xxx \
  -H "Authorization: Bearer $HYPERSWITCH_API_KEY"

# Check Kill Bill payment state
curl -X GET http://localhost:8080/1.0/kb/payments/payment-id \
  -H "Authorization: Basic ..."
```

## Monitoring & Logging

### Enable Debug Logging

In Kill Bill's logback configuration:

```xml
<logger name="io.forgepay.killbill" level="DEBUG" />
```

### Log Levels

- **ERROR**: Payment failures, network errors, configuration issues
- **WARN**: Invalid signatures, retries, non-critical failures
- **INFO**: Payment lifecycle (authorize, capture, refund), webhook processing
- **DEBUG**: Request/response details, idempotency keys, data transformations

### Metrics to Monitor

- Payment success rate: `successful_payments / total_payments`
- Average payment latency: `duration_ms` per operation
- Webhook delivery time: Time from Hyperswitch to Kill Bill update
- Error rate by error code: `NETWORK_ERROR`, `API_ERROR`, etc.

### Health Checks

```bash
# Kill Bill health
curl http://localhost:8080/1.0/kb/health

# Plugin status
curl http://localhost:8080/1.0/kb/tenants/plugins | grep forgepay

# Hyperswitch health
curl http://payment-engine:8080/health
```

## Maintenance

### Version Updates

When upgrading Kill Bill, test compatibility:

```bash
# Update pom.xml
<killbill.version>0.25.0</killbill.version>

# Rebuild and test
mvn clean package
mvn test
```

### Dependency Updates

```bash
# Check for dependency updates
mvn dependency:tree
mvn versions:display-dependency-updates

# Update dependencies
mvn versions:update-properties
```

### Backups

Backup configuration and state:

```bash
# Kill Bill configuration
tar -czf killbill-config.tar.gz /etc/killbill/

# Plugin JAR
cp /var/lib/killbill/plugins/payments/forgepay-payment-plugin.jar /backups/

# Kill Bill database (depends on backend)
pg_dump killbill > killbill-backup.sql
```

## Contributing

### Build & Test Locally

```bash
# Clone and build
git clone https://github.com/forgepayio/forgepay-platform.git
cd forgepay/services/billing-engine/forgepay-plugin
mvn clean package -DskipTests

# Run tests with mock Hyperswitch
mvn test

# View test report
open target/surefire-reports/index.html
```

### Code Style

- Use 4-space indentation
- Follow Google Java Style Guide
- Document public methods with Javadoc
- Include test cases for new features

## Support

- **Documentation**: https://docs.forgepay.io/plugins/killbill
- **Issues**: https://github.com/forgepayio/forgepay-platform/issues
- **Slack**: #forgepay-support
- **Email**: support@forgepay.io

## License

Apache License 2.0 - See LICENSE file

## Changelog

### v0.1.0 (May 2026)

- Initial release
- Full PaymentPluginApi implementation
  - Authorize, capture, refund, void operations
  - Payment status retrieval
  - Async webhook support
- Comprehensive test coverage (8+ test cases)
- HMAC-SHA256 webhook signature verification
- Idempotent payment processing
- Support for multiple payment methods and currencies
- Production-ready error handling and logging
- Docker deployment support
- Comprehensive documentation

## Roadmap

- [ ] 3D Secure (3DS) support
- [ ] Recurring/subscription payment enhancements
- [ ] Advanced dispute handling
- [ ] PCI DSS v4.0 compliance
- [ ] Kafka event streaming
- [ ] Prometheus metrics export
- [ ] Distributed tracing (Jaeger)
- [ ] Rate limiting and backpressure
