package io.forgepay.killbill;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;

/**
 * Webhook handler for ForgePay payment events from unified-router.
 * Listens for payment_status_updated events and updates Kill Bill transaction states.
 *
 * Webhook endpoint: /webhooks/killbill (registered in Kill Bill config)
 * Event source: unified-router (normalizes Hyperswitch webhooks)
 */
public class ForgepayWebhookHandler {

    private static final Logger logger = LoggerFactory.getLogger(ForgepayWebhookHandler.class);

    private final ForgepayPluginConfig config;

    public ForgepayWebhookHandler(ForgepayPluginConfig config) {
        this.config = config;
    }

    /**
     * Processes incoming webhook from unified-router.
     * Validates HMAC signature and updates payment status in Kill Bill.
     *
     * @param payload JSON payload from webhook
     * @param signature HMAC-SHA256 signature (X-Signature header)
     * @return Map with processing result
     */
    public Map<String, Object> handleWebhook(String payload, String signature) {
        Map<String, Object> result = new HashMap<>();

        try {
            // Validate webhook signature
            if (!verifySignature(payload, signature)) {
                logger.warn("Invalid webhook signature, rejecting");
                result.put("status", "rejected");
                result.put("reason", "invalid_signature");
                return result;
            }

            // Parse payload
            JsonObject event = JsonParser.parseString(payload).getAsJsonObject();

            // Extract event metadata
            String eventType = event.has("type") ? event.get("type").getAsString() : null;
            String paymentId = event.has("payment_id") ? event.get("payment_id").getAsString() : null;
            String transactionStatus = event.has("status") ? event.get("status").getAsString() : null;
            String errorMessage = event.has("error_message") ? event.get("error_message").getAsString() : null;

            logger.info("Processing webhook: eventType={}, paymentId={}, status={}",
                    eventType, paymentId, transactionStatus);

            // Handle different event types
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

            return result;

        } catch (Exception e) {
            logger.error("Error processing webhook", e);
            result.put("status", "error");
            result.put("reason", e.getMessage());
            return result;
        }
    }

    /**
     * Handles payment status update event.
     * Maps Hyperswitch status to Kill Bill transaction state.
     *
     * Status mappings:
     * - "succeeded" → CAPTURE (payment completed)
     * - "processing" → PENDING (awaiting result)
     * - "requires_customer_action" → PENDING
     * - "failed" → FAILED (payment rejected)
     * - "canceled" → FAILED
     *
     * @param paymentId Hyperswitch payment ID
     * @param status Hyperswitch payment status
     * @param errorMessage Error message if status is failed
     */
    private void handlePaymentStatusUpdate(String paymentId, String status, String errorMessage) {
        logger.info("Payment status update: paymentId={}, status={}", paymentId, status);

        // Determine Kill Bill transaction status
        String kbStatus;
        switch (status.toLowerCase()) {
            case "succeeded":
                kbStatus = "CAPTURE";
                logger.info("Payment succeeded: paymentId={}", paymentId);
                // Trigger invoice reconciliation in Kill Bill
                reconcileInvoice(paymentId);
                break;
            case "processing":
            case "requires_customer_action":
                kbStatus = "PENDING";
                logger.info("Payment pending: paymentId={}", paymentId);
                break;
            case "failed":
            case "canceled":
                kbStatus = "FAILED";
                logger.warn("Payment failed: paymentId={}, error={}", paymentId, errorMessage);
                // Trigger dunning retry logic (handled by Kill Bill)
                break;
            default:
                logger.warn("Unknown payment status: {}", status);
                return;
        }

        // Update Kill Bill payment transaction state
        updateKillBillPaymentState(paymentId, kbStatus, errorMessage);
    }

    /**
     * Handles refund completed event.
     *
     * @param paymentId Hyperswitch payment ID
     * @param status Refund status (succeeded/failed)
     * @param errorMessage Error message if failed
     */
    private void handleRefundCompleted(String paymentId, String status, String errorMessage) {
        logger.info("Refund completed: paymentId={}, status={}", paymentId, status);

        if ("succeeded".equalsIgnoreCase(status)) {
            logger.info("Refund succeeded: paymentId={}", paymentId);
            updateKillBillPaymentState(paymentId, "REFUND", null);
        } else {
            logger.warn("Refund failed: paymentId={}, error={}", paymentId, errorMessage);
            updateKillBillPaymentState(paymentId, "REFUND_FAILED", errorMessage);
        }
    }

    /**
     * Updates Kill Bill payment state based on webhook event.
     * In actual implementation, this would call Kill Bill API or update database.
     *
     * @param paymentId Hyperswitch payment ID
     * @param kbStatus Kill Bill transaction status (CAPTURE/PENDING/FAILED/REFUND)
     * @param errorMessage Error message if applicable
     */
    private void updateKillBillPaymentState(String paymentId, String kbStatus, String errorMessage) {
        // This is a placeholder for actual Kill Bill integration
        // In production, this would:
        // 1. Look up Kill Bill transaction by externalPaymentId (paymentId)
        // 2. Update transaction status via Kill Bill API
        // 3. Trigger invoice reconciliation if payment succeeded
        // 4. Trigger dunning retry if payment failed

        logger.debug("Updating Kill Bill payment state: paymentId={}, status={}, error={}",
                paymentId, kbStatus, errorMessage);

        // TODO: Integrate with Kill Bill API
        // Example pseudocode:
        // Transaction txn = killbillApi.getTransactionByExternalId(paymentId);
        // if (txn != null) {
        //     killbillApi.updateTransactionStatus(txn.getId(), kbStatus, errorMessage);
        //     if ("CAPTURE".equals(kbStatus)) {
        //         killbillApi.reconcileInvoice(txn.getInvoiceId());
        //     }
        // }
    }

    /**
     * Triggers invoice reconciliation in Kill Bill.
     * Reconciles invoice with successful payment transaction.
     *
     * @param paymentId Hyperswitch payment ID
     */
    private void reconcileInvoice(String paymentId) {
        logger.debug("Reconciling invoice for payment: paymentId={}", paymentId);

        // TODO: Integrate with Kill Bill API
        // killbillApi.reconcileInvoice(invoiceId, paymentId);
    }

    /**
     * Verifies HMAC-SHA256 signature of webhook payload.
     * Uses webhook secret from configuration.
     *
     * @param payload Raw JSON payload from webhook
     * @param signature HMAC-SHA256 signature from X-Signature header
     * @return true if signature is valid, false otherwise
     */
    private boolean verifySignature(String payload, String signature) {
        String secret = config.getWebhookSecret();

        // Skip verification if secret not configured
        if (secret == null || secret.trim().isEmpty()) {
            logger.warn("Webhook signature verification disabled (no secret configured)");
            return true;
        }

        try {
            String expectedSignature = computeHmacSha256(payload, secret);
            boolean valid = expectedSignature.equalsIgnoreCase(signature);

            if (!valid) {
                logger.warn("Webhook signature mismatch. Expected: {}, Got: {}",
                        expectedSignature, signature);
            }

            return valid;

        } catch (Exception e) {
            logger.error("Error verifying webhook signature", e);
            return false;
        }
    }

    /**
     * Computes HMAC-SHA256 of payload using secret key.
     *
     * @param payload Payload to sign
     * @param secret Secret key
     * @return Hex-encoded HMAC-SHA256
     */
    private String computeHmacSha256(String payload, String secret) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        javax.crypto.spec.SecretKeySpec keySpec = new javax.crypto.spec.SecretKeySpec(
                secret.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                0,
                secret.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                "HmacSHA256");
        mac.init(keySpec);

        byte[] hash = mac.doFinal(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return bytesToHex(hash);
    }

    /**
     * Converts byte array to hex string.
     */
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
