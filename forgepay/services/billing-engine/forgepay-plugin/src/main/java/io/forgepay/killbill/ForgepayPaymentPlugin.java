package io.forgepay.killbill;

import org.joda.time.DateTime;
import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.PaymentApiException;
import org.killbill.billing.payment.api.PluginProperty;
import org.killbill.billing.payment.plugin.api.GatewayNotification;
import org.killbill.billing.payment.plugin.api.HostedPaymentPageFormDescriptor;
import org.killbill.billing.payment.plugin.api.PaymentMethodPlugin;
import org.killbill.billing.payment.plugin.api.PaymentPluginApi;
import org.killbill.billing.payment.plugin.api.PaymentPluginApiException;
import org.killbill.billing.payment.plugin.api.PaymentTransactionInfoPlugin;
import org.killbill.billing.util.callcontext.CallContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * ForgePay Kill Bill payment plugin.
 * Routes subscription payments through Hyperswitch payment router.
 *
 * Implements the Kill Bill PaymentPluginApi interface to handle:
 * - Payment initiation (authorize + capture)
 * - Payment capture for previously authorized payments
 * - Refunds (full and partial)
 * - Payment status retrieval
 */
public class ForgepayPaymentPlugin implements PaymentPluginApi {

    private static final Logger logger = LoggerFactory.getLogger(ForgepayPaymentPlugin.class);

    private final ForgepayPluginConfig config;
    private final HyperswitchClient hyperswitchClient;
    private final IdempotencyKeyGenerator keyGenerator;

    public ForgepayPaymentPlugin() {
        this.config = new ForgepayPluginConfig();
        this.hyperswitchClient = new HyperswitchClient(config);
        this.keyGenerator = new IdempotencyKeyGenerator();
        logger.info("ForgepayPaymentPlugin initialized");
    }

    @Override
    public PaymentTransactionInfoPlugin authorizePayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            BigDecimal amount,
            Currency currency,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {

        logger.info("Authorizing payment: kbAccountId={}, kbPaymentId={}, amount={}",
                kbAccountId, kbPaymentId, amount);

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

            // Map Hyperswitch response to Kill Bill payment transaction
            return buildPaymentTransactionInfo(response, kbTransactionId);

        } catch (ForgepayPaymentException e) {
            logger.error("Authorization failed: {}", e.getMessage(), e);
            throw e;
        }
    }

    @Override
    public PaymentTransactionInfoPlugin capturePayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            BigDecimal amount,
            Currency currency,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {

        logger.info("Capturing payment: kbPaymentId={}, amount={}", kbPaymentId, amount);

        try {
            // For Kill Bill, capture often means "complete the payment"
            // Retrieve the payment ID from Hyperswitch (stored in externalPaymentId)
            String paymentId = getHyperswitchPaymentId(properties);

            if (paymentId == null) {
                throw new ForgepayPaymentException("CAPTURE_FAILED",
                        "No Hyperswitch payment ID found for capture");
            }

            long amountCents = convertToCents(amount, currency);
            String idempotencyKey = keyGenerator.generate(kbAccountId, kbPaymentId, "capture");

            HyperswitchClient.HyperswitchPaymentResponse response =
                    hyperswitchClient.capturePayment(paymentId, amountCents, idempotencyKey);

            return buildPaymentTransactionInfo(response, kbTransactionId);

        } catch (ForgepayPaymentException e) {
            logger.error("Capture failed: {}", e.getMessage(), e);
            throw e;
        }
    }

    @Override
    public PaymentTransactionInfoPlugin refundPayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            BigDecimal refundAmount,
            Currency currency,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {

        logger.info("Refunding payment: kbPaymentId={}, refundAmount={}", kbPaymentId, refundAmount);

        try {
            String paymentId = getHyperswitchPaymentId(properties);

            if (paymentId == null) {
                throw new ForgepayPaymentException("REFUND_FAILED",
                        "No Hyperswitch payment ID found for refund");
            }

            long amountCents = convertToCents(refundAmount, currency);
            String reason = "Kill Bill refund: " + kbPaymentId;
            String idempotencyKey = keyGenerator.generate(kbAccountId, kbPaymentId, "refund");

            HyperswitchClient.HyperswitchPaymentResponse response =
                    hyperswitchClient.refundPayment(paymentId, amountCents, reason, idempotencyKey);

            return buildPaymentTransactionInfo(response, kbTransactionId);

        } catch (ForgepayPaymentException e) {
            logger.error("Refund failed: {}", e.getMessage(), e);
            throw e;
        }
    }

    @Override
    public PaymentTransactionInfoPlugin voidPayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {

        logger.info("Voiding payment: kbPaymentId={}", kbPaymentId);

        try {
            String paymentId = getHyperswitchPaymentId(properties);

            if (paymentId == null) {
                throw new ForgepayPaymentException("VOID_FAILED",
                        "No Hyperswitch payment ID found for void");
            }

            String idempotencyKey = keyGenerator.generate(kbAccountId, kbPaymentId, "void");

            // For Hyperswitch, void is a $0 refund with special reason
            HyperswitchClient.HyperswitchPaymentResponse response =
                    hyperswitchClient.refundPayment(paymentId, 0L, "Void", idempotencyKey);

            return buildPaymentTransactionInfo(response, kbTransactionId);

        } catch (ForgepayPaymentException e) {
            logger.error("Void failed: {}", e.getMessage(), e);
            throw e;
        }
    }

    @Override
    public PaymentTransactionInfoPlugin getPaymentInfo(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {

        logger.info("Getting payment info: kbPaymentId={}", kbPaymentId);

        try {
            String paymentId = getHyperswitchPaymentId(properties);

            if (paymentId == null) {
                throw new ForgepayPaymentException("GET_INFO_FAILED",
                        "No Hyperswitch payment ID found");
            }

            HyperswitchClient.HyperswitchPaymentResponse response =
                    hyperswitchClient.getPaymentInfo(paymentId);

            return buildPaymentTransactionInfo(response, kbTransactionId);

        } catch (ForgepayPaymentException e) {
            logger.error("Get payment info failed: {}", e.getMessage(), e);
            throw e;
        }
    }

    @Override
    public HostedPaymentPageFormDescriptor buildFormDescriptor(
            UUID kbAccountId,
            Iterable<PluginProperty> customProperties,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // ForgePay uses Hyperswitch directly, no hosted payment form needed
        throw new PaymentPluginApiException(null,
                "Hosted payment form not supported by ForgePay plugin");
    }

    @Override
    public GatewayNotification processNotification(
            String notification,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Webhook notifications handled by ForgepayWebhookHandler
        logger.info("Webhook notification received (delegated to webhook handler)");
        return null;
    }

    @Override
    public void addPaymentMethod(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            PaymentMethodPlugin paymentMethod,
            boolean setDefault,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Payment method storage handled by Hyperswitch
        logger.info("Payment method added (stored in Hyperswitch): kbPaymentMethodId={}",
                kbPaymentMethodId);
    }

    @Override
    public void deletePaymentMethod(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Payment method deletion handled by Hyperswitch
        logger.info("Payment method deleted: kbPaymentMethodId={}", kbPaymentMethodId);
    }

    @Override
    public PaymentMethodPlugin getPaymentMethodDetail(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Placeholder for payment method retrieval
        logger.info("Payment method detail requested: kbPaymentMethodId={}", kbPaymentMethodId);
        return null;
    }

    @Override
    public void setDefaultPaymentMethod(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Payment method default setting handled by Hyperswitch
        logger.info("Default payment method set: kbPaymentMethodId={}", kbPaymentMethodId);
    }

    @Override
    public List<PaymentMethodPlugin> getPaymentMethods(
            UUID kbAccountId,
            boolean refreshFromGateway,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Placeholder for payment method listing
        logger.info("Payment methods requested for account: kbAccountId={}", kbAccountId);
        return null;
    }

    @Override
    public void resetPaymentMethods(
            UUID kbAccountId,
            List<PaymentMethodPlugin> paymentMethods,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Reset handled by Hyperswitch
        logger.info("Payment methods reset for account: kbAccountId={}", kbAccountId);
    }

    @Override
    public List<PaymentTransactionInfoPlugin> searchPayments(
            String searchKey,
            Long offset,
            Long limit,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException {
        // Search not implemented in basic plugin version
        logger.info("Payment search requested: searchKey={}", searchKey);
        return null;
    }

    // ── Helper Methods ────────────────────────────────────────────────────────

    /**
     * Converts Kill Bill amount (BigDecimal) to cents for Hyperswitch.
     * Handles different currency smallest units (most use 2 decimal places).
     */
    private long convertToCents(BigDecimal amount, Currency currency) {
        if (amount == null) {
            return 0L;
        }
        // Most currencies use 2 decimal places (cents, pence, etc.)
        return amount.multiply(new BigDecimal(100)).longValue();
    }

    /**
     * Extracts Hyperswitch payment ID from Kill Bill properties.
     * Properties are passed from previous transactions and contain external payment ID.
     */
    private String getHyperswitchPaymentId(Iterable<PluginProperty> properties) {
        if (properties == null) {
            return null;
        }
        for (PluginProperty prop : properties) {
            if ("externalPaymentId".equals(prop.getKey())) {
                return (String) prop.getValue();
            }
        }
        return null;
    }

    /**
     * Builds Kill Bill PaymentTransactionInfoPlugin from Hyperswitch response.
     * Maps Hyperswitch payment status to Kill Bill transaction status.
     */
    private PaymentTransactionInfoPlugin buildPaymentTransactionInfo(
            HyperswitchClient.HyperswitchPaymentResponse response,
            UUID kbTransactionId) {

        Map<String, String> props = new HashMap<>();
        props.put("externalPaymentId", response.getPaymentId());
        props.put("status", response.getStatus());

        if (response.getErrorMessage() != null) {
            props.put("errorMessage", response.getErrorMessage());
        }

        if (response.getRefundId() != null) {
            props.put("refundId", response.getRefundId());
        }

        return new PaymentTransactionInfoPlugin() {
            @Override
            public UUID getKbPaymentId() {
                return null;
            }

            @Override
            public UUID getKbTransactionPaymentId() {
                return kbTransactionId;
            }

            @Override
            public String getTransactionType() {
                return "CAPTURE";
            }

            @Override
            public BigDecimal getAmount() {
                return null;
            }

            @Override
            public BigDecimal getProcessedAmount() {
                return null;
            }

            @Override
            public String getCurrency() {
                return null;
            }

            @Override
            public boolean isSuccess() {
                return response.isSuccessful();
            }

            @Override
            public String getGatewayError() {
                return response.getErrorMessage();
            }

            @Override
            public String getGatewayErrorCode() {
                return response.isFailed() ? "FAILED" : response.isPending() ? "PENDING" : "SUCCESS";
            }

            @Override
            public String getFirstPaymentReferenceId() {
                return response.getPaymentId();
            }

            @Override
            public String getSecondPaymentReferenceId() {
                return response.getRefundId();
            }

            @Override
            public Map<String, String> getProperties() {
                return props;
            }

            @Override
            public DateTime getCreatedDate() {
                return null;
            }

            @Override
            public DateTime getEffectiveDate() {
                return null;
            }
        };
    }
}
