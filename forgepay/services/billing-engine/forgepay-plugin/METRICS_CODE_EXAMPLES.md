# Prometheus Metrics - Code Examples

This document provides code examples showing how metrics are used throughout the ForgePay Kill Bill plugin.

## 1. Metrics Initialization

**File**: `ForgepayPaymentPlugin.java` (constructor)

```java
public ForgepayPaymentPlugin() {
    this.config = new ForgepayPluginConfig();
    this.hyperswitchClient = new HyperswitchClient(config);
    this.keyGenerator = new IdempotencyKeyGenerator();

    // Initialize Prometheus metrics registry
    try {
        MetricsRegistry.initialize();
        logger.info("Prometheus metrics initialized successfully");
    } catch (Exception e) {
        logger.warn("Failed to initialize Prometheus metrics: {}", e.getMessage());
        // Non-fatal: metrics won't be available but plugin continues to work
    }

    logger.info("ForgepayPaymentPlugin initialized");
}
```

**What happens**:
1. `MetricsRegistry.initialize()` creates a PrometheusMeterRegistry (singleton)
2. All 4 custom metrics are registered with the registry
3. If initialization fails, the plugin still works (metrics just won't be collected)

## 2. Recording Payment Operation Metrics

**File**: `ForgepayPaymentPlugin.java` (authorizePayment method)

### Step 1: Start the timer
```java
Timer.Sample sample = Timer.start(MetricsRegistry.getMeterRegistry());
String status = "unknown";
```

### Step 2: Execute payment operation
```java
try {
    // Convert amount to cents (or smallest unit for currency)
    long amountCents = convertToCents(amount, currency);

    // Generate idempotency key
    String idempotencyKey = keyGenerator.generate(kbAccountId, kbPaymentId, "authorize");

    // Initiate payment in Hyperswitch with "authorize" intent
    HyperswitchClient.HyperswitchPaymentResponse response =
            hyperswitchClient.initiatePayment(
                    kbAccountId.toString(),
                    amountCents,
                    currency.name(),
                    kbPaymentId.toString(),
                    idempotencyKey);

    // Record payment attempt metric
    status = response.isSuccessful() ? "success" : response.isFailed() ? "failed" : "pending";
    MetricsRegistry.incrementPaymentAttempts(status, "card");

    // Return result
    return buildPaymentTransactionInfo(response, kbTransactionId);
```

### Step 3: Handle errors
```java
} catch (ForgepayPaymentException e) {
    logger.error("Authorization failed: {}", e.getMessage(), e);
    status = "failed";
    MetricsRegistry.incrementPaymentAttempts(status, "card");
    throw e;
```

### Step 4: Always record duration
```java
} finally {
    // Record payment processing duration
    MetricsRegistry.recordPaymentDuration(sample, status);
}
```

**Metrics recorded**:
- `payment_processing_duration_seconds` with tags: `status=success/failed/pending`
- `payment_attempts_total` with tags: `status=success/failed/pending`, `method=card`

## 3. Recording Webhook Processing Metrics

**File**: `ForgepayWebhookHandler.java` (handleWebhook method)

```java
public Map<String, Object> handleWebhook(String payload, String signature) {
    Map<String, Object> result = new HashMap<>();
    
    // Step 1: Start timing
    Timer.Sample sample = Timer.start(MetricsRegistry.getMeterRegistry());
    String eventType = "unknown";

    try {
        // Step 2: Validate and parse webhook
        if (!verifySignature(payload, signature)) {
            logger.warn("Invalid webhook signature, rejecting");
            result.put("status", "rejected");
            result.put("reason", "invalid_signature");
            return result;
        }

        JsonObject event = JsonParser.parseString(payload).getAsJsonObject();
        
        // Step 3: Extract event type
        eventType = event.has("type") ? event.get("type").getAsString() : "unknown";
        String paymentId = event.has("payment_id") ? event.get("payment_id").getAsString() : null;
        String transactionStatus = event.has("status") ? event.get("status").getAsString() : null;
        String errorMessage = event.has("error_message") ? event.get("error_message").getAsString() : null;

        logger.info("Processing webhook: eventType={}, paymentId={}, status={}",
                eventType, paymentId, transactionStatus);

        // Step 4: Handle different event types
        if ("payment_status_updated".equals(eventType)) {
            handlePaymentStatusUpdate(paymentId, transactionStatus, errorMessage);
            result.put("status", "processed");
            result.put("paymentId", paymentId);
        } else if ("refund_completed".equals(eventType)) {
            handleRefundCompleted(paymentId, transactionStatus, errorMessage);
            result.put("status", "processed");
            result.put("eventType", "refund_completed");
        } else {
            logger.warn("Unknown event type: {}", eventType);
            result.put("status", "ignored");
            result.put("reason", "unknown_event_type");
        }

        // Step 5: Record success
        MetricsRegistry.incrementWebhookEventsProcessed(eventType);
        return result;

    } catch (Exception e) {
        logger.error("Error processing webhook", e);
        result.put("status", "error");
        result.put("reason", e.getMessage());
        
        // Step 5: Record error
        MetricsRegistry.incrementWebhookEventsProcessed(eventType + ".error");
        return result;
        
    } finally {
        // Step 6: Always record duration
        MetricsRegistry.recordWebhookDuration(sample, eventType);
    }
}
```

**Metrics recorded**:
- `webhook_processing_duration_seconds` with tag: `event_type=payment_status_updated/refund_completed/unknown/etc`
- `webhook_events_processed_total` with tag: `event_type=payment_status_updated/refund_completed/unknown.error/etc`

## 4. MetricsRegistry Implementation Details

**File**: `MetricsRegistry.java`

### Initialization (synchronized for thread-safety)
```java
public static synchronized void initialize() {
    if (registryHolder.get() != null) {
        logger.debug("MetricsRegistry already initialized");
        return;
    }

    try {
        PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        registryHolder.set(registry);

        // Initialize payment processing timer
        paymentProcessingDurationTimer = Timer.builder("payment_processing_duration_seconds")
                .description("Time taken to process a payment transaction")
                .tag("service", "forgepay-killbill-plugin")
                .publishPercentiles(0.5, 0.95, 0.99)
                .register(registry);

        // Initialize payment attempts counter
        paymentAttemptsCounter = Counter.builder("payment_attempts_total")
                .description("Total number of payment attempts")
                .tag("service", "forgepay-killbill-plugin")
                .register(registry);

        // Initialize webhook metrics...
        // ...

        logger.info("MetricsRegistry initialized successfully with Prometheus registry");
    } catch (Exception e) {
        logger.error("Failed to initialize MetricsRegistry", e);
        throw new RuntimeException("Failed to initialize Prometheus metrics", e);
    }
}
```

### Recording Metrics (with exception handling)
```java
public static void incrementPaymentAttempts(String status, String method) {
    try {
        if (paymentAttemptsCounter != null) {
            Counter.builder("payment_attempts_total")
                    .tag("status", status != null ? status : "unknown")
                    .tag("method", method != null ? method : "unknown")
                    .tag("service", "forgepay-killbill-plugin")
                    .register(getMeterRegistry())
                    .increment();
        }
    } catch (Exception e) {
        logger.warn("Failed to increment payment attempts counter", e);
    }
}
```

### Exporting Metrics
```java
public static String getPrometheusMetricsText() {
    try {
        return getPrometheusRegistry().scrape();
    } catch (Exception e) {
        logger.error("Failed to scrape Prometheus metrics", e);
        return "";
    }
}
```

## 5. MetricsServlet Implementation

**File**: `MetricsServlet.java`

```java
@Override
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws ServletException, IOException {
    try {
        // Set response headers
        response.setContentType("text/plain; version=0.0.4; charset=utf-8");
        response.setCharacterEncoding("UTF-8");
        response.setStatus(HttpServletResponse.SC_OK);

        // Get Prometheus metrics as text
        String metricsText = MetricsRegistry.getPrometheusMetricsText();

        // Write metrics to response body
        response.getWriter().write(metricsText);
        response.getWriter().flush();

        logger.debug("Prometheus metrics scraped successfully");
    } catch (IllegalStateException e) {
        logger.error("MetricsRegistry not initialized", e);
        response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
        response.getWriter().write("Metrics service unavailable: " + e.getMessage());
        response.getWriter().flush();
    } catch (Exception e) {
        logger.error("Error generating Prometheus metrics", e);
        response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        response.getWriter().write("Error generating metrics: " + e.getMessage());
        response.getWriter().flush();
    }
}
```

## 6. Prometheus Output Example

When you call `GET /metrics`, you'll see output like:

```prometheus
# HELP payment_processing_duration_seconds Time taken to process a payment transaction
# TYPE payment_processing_duration_seconds histogram
payment_processing_duration_seconds_bucket{le="0.001",service="forgepay-killbill-plugin",status="success"} 10
payment_processing_duration_seconds_bucket{le="0.01",service="forgepay-killbill-plugin",status="success"} 45
payment_processing_duration_seconds_bucket{le="0.1",service="forgepay-killbill-plugin",status="success"} 98
payment_processing_duration_seconds_bucket{le="1.0",service="forgepay-killbill-plugin",status="success"} 100
payment_processing_duration_seconds_bucket{le="10.0",service="forgepay-killbill-plugin",status="success"} 100
payment_processing_duration_seconds_bucket{le="+Inf",service="forgepay-killbill-plugin",status="success"} 100
payment_processing_duration_seconds_sum{service="forgepay-killbill-plugin",status="success"} 45.123
payment_processing_duration_seconds_count{service="forgepay-killbill-plugin",status="success"} 100
payment_processing_duration_seconds{quantile="0.5",service="forgepay-killbill-plugin",status="success"} 0.45
payment_processing_duration_seconds{quantile="0.95",service="forgepay-killbill-plugin",status="success"} 0.88
payment_processing_duration_seconds{quantile="0.99",service="forgepay-killbill-plugin",status="success"} 0.95

# HELP payment_attempts_total Total number of payment attempts
# TYPE payment_attempts_total counter
payment_attempts_total{method="card",service="forgepay-killbill-plugin",status="failed"} 2
payment_attempts_total{method="card",service="forgepay-killbill-plugin",status="success"} 100
payment_attempts_total{method="refund",service="forgepay-killbill-plugin",status="success"} 45
payment_attempts_total{method="void",service="forgepay-killbill-plugin",status="success"} 12
payment_attempts_total{method="status_query",service="forgepay-killbill-plugin",status="success"} 234

# HELP webhook_events_processed_total Total number of webhook events processed
# TYPE webhook_events_processed_total counter
webhook_events_processed_total{event_type="payment_status_updated",service="forgepay-killbill-plugin"} 5421
webhook_events_processed_total{event_type="refund_completed",service="forgepay-killbill-plugin"} 123

# HELP webhook_processing_duration_seconds Time taken to process a webhook event
# TYPE webhook_processing_duration_seconds histogram
webhook_processing_duration_seconds_bucket{event_type="payment_status_updated",le="0.01",service="forgepay-killbill-plugin"} 5200
webhook_processing_duration_seconds_bucket{event_type="payment_status_updated",le="0.1",service="forgepay-killbill-plugin"} 5400
webhook_processing_duration_seconds_sum{event_type="payment_status_updated",service="forgepay-killbill-plugin"} 234.56
webhook_processing_duration_seconds_count{event_type="payment_status_updated",service="forgepay-killbill-plugin"} 5421
webhook_processing_duration_seconds{quantile="0.5",event_type="payment_status_updated",service="forgepay-killbill-plugin"} 0.04
webhook_processing_duration_seconds{quantile="0.95",event_type="payment_status_updated",service="forgepay-killbill-plugin"} 0.05
webhook_processing_duration_seconds{quantile="0.99",event_type="payment_status_updated",service="forgepay-killbill-plugin"} 0.06
```

## 7. Error Handling Examples

### Scenario 1: Authorization fails during Hyperswitch call
```java
Timer.Sample sample = Timer.start(MetricsRegistry.getMeterRegistry());
String status = "unknown";

try {
    HyperswitchClient.HyperswitchPaymentResponse response =
            hyperswitchClient.initiatePayment(...);
    status = response.isSuccessful() ? "success" : "failed";
    MetricsRegistry.incrementPaymentAttempts(status, "card");
    
} catch (ForgepayPaymentException e) {
    // Exception path: still records metrics
    status = "failed";
    MetricsRegistry.incrementPaymentAttempts(status, "card");
    throw e;
    
} finally {
    // Always records duration, even on exception
    MetricsRegistry.recordPaymentDuration(sample, status);
}
```

**Result**: Both metrics are recorded (counter + timer), even though exception was thrown.

### Scenario 2: Webhook parsing fails
```java
Timer.Sample sample = Timer.start(MetricsRegistry.getMeterRegistry());
String eventType = "unknown";

try {
    JsonObject event = JsonParser.parseString(payload).getAsJsonObject();
    eventType = event.get("type").getAsString();
    // process...
    MetricsRegistry.incrementWebhookEventsProcessed(eventType);
    
} catch (Exception e) {
    // Records error with .error suffix
    MetricsRegistry.incrementWebhookEventsProcessed(eventType + ".error");
    
} finally {
    // Records duration regardless
    MetricsRegistry.recordWebhookDuration(sample, eventType);
}
```

**Result**: `webhook_events_processed_total{event_type="unknown.error"}` is incremented, and duration timer is still recorded.

## 8. Testing Example

```java
@Test
public void testPaymentMetricsRecording() {
    // Reset metrics before test
    MetricsRegistry.reset();
    MetricsRegistry.initialize();
    
    ForgepayPaymentPlugin plugin = new ForgepayPaymentPlugin();
    
    // Execute payment operation
    plugin.authorizePayment(
        UUID.randomUUID(), // kbAccountId
        UUID.randomUUID(), // kbPaymentId
        UUID.randomUUID(), // kbTransactionId
        UUID.randomUUID(), // kbPaymentMethodId
        BigDecimal.valueOf(100),
        Currency.USD,
        Collections.emptyList(),
        null
    );
    
    // Assert metrics were recorded
    String metricsText = MetricsRegistry.getPrometheusMetricsText();
    assert(metricsText.contains("payment_attempts_total"));
    assert(metricsText.contains("payment_processing_duration_seconds"));
    
    // Clean up
    MetricsRegistry.reset();
}
```

## Summary

The metrics implementation follows these patterns:

1. **Timer Usage**: Start timer → execute operation → stop timer in finally
2. **Counter Usage**: Determine outcome → increment counter
3. **Labels**: Use consistent label values (status, method, event_type)
4. **Error Handling**: Try-catch-finally ensures metrics are recorded even on exceptions
5. **Thread Safety**: AtomicReference + synchronized methods prevent race conditions
6. **Graceful Degradation**: Failed metrics recording doesn't block payment processing
