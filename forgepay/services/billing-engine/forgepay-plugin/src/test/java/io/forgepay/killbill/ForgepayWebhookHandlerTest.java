package io.forgepay.killbill;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for ForgepayWebhookHandler.
 * Tests webhook processing and signature verification.
 */
public class ForgepayWebhookHandlerTest {

    private ForgepayWebhookHandler webhookHandler;
    private ForgepayPluginConfig config;
    private static final String WEBHOOK_SECRET = "test-webhook-secret";

    @BeforeEach
    public void setUp() {
        System.setProperty("HYPERSWITCH_API_URL", "http://localhost:8080");
        System.setProperty("HYPERSWITCH_API_KEY", "test-api-key");
        System.setProperty("KILLBILL_HYPERSWITCH_WEBHOOK_SECRET", WEBHOOK_SECRET);

        config = new ForgepayPluginConfig();
        webhookHandler = new ForgepayWebhookHandler(config);
    }

    @Test
    public void testHandlePaymentStatusUpdateSucceeded() {
        String payload = "{" +
                "\"type\": \"payment_status_updated\"," +
                "\"payment_id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"," +
                "\"amount\": 500" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(payload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("processed");
        assertThat(result.get("paymentId")).isEqualTo("pay_123456789");
    }

    @Test
    public void testHandlePaymentStatusUpdateFailed() {
        String payload = "{" +
                "\"type\": \"payment_status_updated\"," +
                "\"payment_id\": \"pay_123456789\"," +
                "\"status\": \"failed\"," +
                "\"error_message\": \"Declined by issuer\"" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(payload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("processed");
    }

    @Test
    public void testHandlePaymentStatusUpdatePending() {
        String payload = "{" +
                "\"type\": \"payment_status_updated\"," +
                "\"payment_id\": \"pay_123456789\"," +
                "\"status\": \"processing\"" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(payload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("processed");
    }

    @Test
    public void testHandleRefundCompleted() {
        String payload = "{" +
                "\"type\": \"refund_completed\"," +
                "\"payment_id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(payload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("processed");
        assertThat(result.get("eventType")).isEqualTo("refund_completed");
    }

    @Test
    public void testHandleRefundFailed() {
        String payload = "{" +
                "\"type\": \"refund_completed\"," +
                "\"payment_id\": \"pay_123456789\"," +
                "\"status\": \"failed\"," +
                "\"error_message\": \"Refund amount exceeds captured amount\"" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(payload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("processed");
    }

    @Test
    public void testWebhookSignatureValidationFailure() {
        String payload = "{" +
                "\"type\": \"payment_status_updated\"," +
                "\"payment_id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"" +
                "}";

        String invalidSignature = "invalid-signature-12345";

        Map<String, Object> result = webhookHandler.handleWebhook(payload, invalidSignature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("rejected");
        assertThat(result.get("reason")).isEqualTo("invalid_signature");
    }

    @Test
    public void testUnknownEventType() {
        String payload = "{" +
                "\"type\": \"unknown_event_type\"," +
                "\"payment_id\": \"pay_123456789\"" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(payload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("ignored");
        assertThat(result.get("reason")).isEqualTo("unknown_event_type");
    }

    @Test
    public void testMalformedPayload() {
        String invalidPayload = "not valid json";
        String signature = computeHmacSha256(invalidPayload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(invalidPayload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("error");
    }

    @Test
    public void testMultipleWebhooksWithSamePayload() {
        String payload = "{" +
                "\"type\": \"payment_status_updated\"," +
                "\"payment_id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        // First webhook should be processed
        Map<String, Object> result1 = webhookHandler.handleWebhook(payload, signature);
        assertThat(result1.get("status")).isEqualTo("processed");

        // Duplicate webhook should also be processed (idempotency handled upstream)
        Map<String, Object> result2 = webhookHandler.handleWebhook(payload, signature);
        assertThat(result2.get("status")).isEqualTo("processed");
    }

    @Test
    public void testWebhookWithAllMetadata() {
        String payload = "{" +
                "\"type\": \"payment_status_updated\"," +
                "\"payment_id\": \"pay_full_details\"," +
                "\"status\": \"succeeded\"," +
                "\"amount\": 10000," +
                "\"currency\": \"USD\"," +
                "\"customer_id\": \"cust_123\"," +
                "\"merchant_id\": \"merchant_456\"," +
                "\"timestamp\": \"2026-05-16T10:30:00Z\"" +
                "}";

        String signature = computeHmacSha256(payload, WEBHOOK_SECRET);

        Map<String, Object> result = webhookHandler.handleWebhook(payload, signature);

        assertThat(result).isNotNull();
        assertThat(result.get("status")).isEqualTo("processed");
        assertThat(result.get("paymentId")).isEqualTo("pay_full_details");
    }

    // Helper method to compute HMAC-SHA256
    private String computeHmacSha256(String payload, String secret) {
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            javax.crypto.spec.SecretKeySpec keySpec = new javax.crypto.spec.SecretKeySpec(
                    secret.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    0,
                    secret.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                    "HmacSHA256");
            mac.init(keySpec);
            byte[] hash = mac.doFinal(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return bytesToHex(hash);
        } catch (Exception e) {
            throw new RuntimeException("Failed to compute HMAC", e);
        }
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }
}
