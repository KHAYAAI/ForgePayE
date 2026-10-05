package io.forgepay.killbill;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.joda.time.DateTime;
import org.joda.time.DateTimeZone;
import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.PaymentMethodPlugin;
import org.killbill.billing.payment.api.PluginProperty;
import org.killbill.billing.payment.api.TransactionType;
import org.killbill.billing.payment.plugin.api.GatewayNotification;
import org.killbill.billing.payment.plugin.api.HostedPaymentPageFormDescriptor;
import org.killbill.billing.payment.plugin.api.PaymentMethodInfoPlugin;
import org.killbill.billing.payment.plugin.api.PaymentPluginApi;
import org.killbill.billing.payment.plugin.api.PaymentPluginApiException;
import org.killbill.billing.payment.plugin.api.PaymentPluginStatus;
import org.killbill.billing.payment.plugin.api.PaymentTransactionInfoPlugin;
import org.killbill.billing.util.callcontext.CallContext;
import org.killbill.billing.util.callcontext.TenantContext;
import org.killbill.billing.util.entity.Pagination;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Kill Bill payment plugin that charges through Hyperswitch.
 *
 * Kill Bill invoices are paid off-session (merchant-initiated) against a card
 * the customer saved at checkout. The Kill Bill payment method carries the
 * Hyperswitch references in its external key:
 *
 *     hyperswitch:<customer_id>:<payment_method_id>
 *
 * which unified-router's checkout sets when it provisions the account.
 *
 * Idempotency and reconciliation without a plugin database: each Kill Bill
 * transaction maps to a deterministic Hyperswitch id, `kb_<transaction id>`
 * for payments and `kbr_<transaction id>` for refunds. A retried request
 * collides with the first and is answered by retrieving it, and
 * getPaymentInfo (Kill Bill's janitor) re-reads every transaction from
 * Hyperswitch by the same ids.
 */
public class HyperswitchPaymentPluginApi implements PaymentPluginApi {

    public static final String PLUGIN_NAME = "forgepay-hyperswitch";
    public static final String KEY_PREFIX = "hyperswitch:";

    private static final Logger LOG = Logger.getLogger(HyperswitchPaymentPluginApi.class.getName());

    private final HyperswitchClient client;
    private final KillbillLookups lookups;

    public HyperswitchPaymentPluginApi(final HyperswitchClient client, final KillbillLookups lookups) {
        this.client = client;
        this.lookups = lookups;
    }

    // ── Ids ─────────────────────────────────────────────────────────────────

    static String paymentIdFor(final UUID kbTransactionId) {
        return "kb_" + kbTransactionId;
    }

    static String refundIdFor(final UUID kbTransactionId) {
        return "kbr_" + kbTransactionId;
    }

    /** customer_id and payment_method_id from a payment method external key, or null. */
    static String[] parseExternalKey(final String externalKey) {
        if (externalKey == null || !externalKey.startsWith(KEY_PREFIX)) return null;
        final String[] parts = externalKey.substring(KEY_PREFIX.length()).split(":", -1);
        if (parts.length != 2 || parts[0].isEmpty() || parts[1].isEmpty()) return null;
        return parts;
    }

    // ── Amounts ─────────────────────────────────────────────────────────────

    static long toMinor(final BigDecimal amount, final Currency currency) {
        final int digits = fractionDigits(currency);
        return amount.setScale(digits, RoundingMode.HALF_UP).movePointRight(digits).longValueExact();
    }

    static BigDecimal fromMinor(final long minor, final Currency currency) {
        return BigDecimal.valueOf(minor).movePointLeft(fractionDigits(currency));
    }

    private static int fractionDigits(final Currency currency) {
        try {
            final int d = java.util.Currency.getInstance(currency.name()).getDefaultFractionDigits();
            return d < 0 ? 2 : d;
        } catch (final IllegalArgumentException e) {
            return 2;
        }
    }

    // ── Status mapping ──────────────────────────────────────────────────────

    /** Hyperswitch IntentStatus (crates/common_enums) → Kill Bill status, per transaction type. */
    static PaymentPluginStatus paymentStatus(final String hs, final TransactionType type) {
        if (hs == null) return PaymentPluginStatus.UNDEFINED;
        switch (hs) {
            case "succeeded":
                return PaymentPluginStatus.PROCESSED;
            case "requires_capture":
            case "partially_authorized_and_requires_capture":
                return type == TransactionType.AUTHORIZE ? PaymentPluginStatus.PROCESSED : PaymentPluginStatus.PENDING;
            case "partially_captured":
            case "partially_captured_and_capturable":
                return type == TransactionType.CAPTURE || type == TransactionType.AUTHORIZE
                        ? PaymentPluginStatus.PROCESSED : PaymentPluginStatus.PENDING;
            case "cancelled":
            case "cancelled_post_capture":
                return type == TransactionType.VOID ? PaymentPluginStatus.PROCESSED : PaymentPluginStatus.ERROR;
            case "failed":
            case "requires_payment_method":
            case "expired":
                return PaymentPluginStatus.ERROR;
            case "processing":
            case "requires_customer_action":
            case "requires_merchant_action":
            case "requires_confirmation":
            case "partially_captured_and_processing":
            case "conflicted":
                return PaymentPluginStatus.PENDING;
            default:
                return PaymentPluginStatus.UNDEFINED;
        }
    }

    /** Hyperswitch RefundStatus (api_models::refunds) → Kill Bill status. */
    static PaymentPluginStatus refundStatus(final String hs) {
        if (hs == null) return PaymentPluginStatus.UNDEFINED;
        switch (hs) {
            case "succeeded": return PaymentPluginStatus.PROCESSED;
            case "failed":    return PaymentPluginStatus.ERROR;
            case "pending":
            case "review":    return PaymentPluginStatus.PENDING;
            default:          return PaymentPluginStatus.UNDEFINED;
        }
    }

    // ── PaymentPluginApi: transactions ──────────────────────────────────────

    @Override
    public PaymentTransactionInfoPlugin authorizePayment(final UUID kbAccountId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                         final UUID kbPaymentMethodId, final BigDecimal amount, final Currency currency,
                                                         final Iterable<PluginProperty> properties, final CallContext context) {
        return createPayment(TransactionType.AUTHORIZE, kbAccountId, kbPaymentId, kbTransactionId, kbPaymentMethodId, amount, currency, context);
    }

    @Override
    public PaymentTransactionInfoPlugin purchasePayment(final UUID kbAccountId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                        final UUID kbPaymentMethodId, final BigDecimal amount, final Currency currency,
                                                        final Iterable<PluginProperty> properties, final CallContext context) {
        return createPayment(TransactionType.PURCHASE, kbAccountId, kbPaymentId, kbTransactionId, kbPaymentMethodId, amount, currency, context);
    }

    private PaymentTransactionInfoPlugin createPayment(final TransactionType type, final UUID kbAccountId, final UUID kbPaymentId,
                                                       final UUID kbTransactionId, final UUID kbPaymentMethodId,
                                                       final BigDecimal amount, final Currency currency, final TenantContext context) {
        final String[] refs;
        try {
            refs = parseExternalKey(lookups.paymentMethodExternalKey(kbPaymentMethodId, context));
        } catch (final Exception e) {
            LOG.log(Level.WARNING, "could not read payment method " + kbPaymentMethodId, e);
            return failed(kbPaymentId, kbTransactionId, type, amount, currency, PaymentPluginStatus.UNDEFINED,
                    "KILLBILL_LOOKUP_FAILED", e.getMessage());
        }
        if (refs == null) {
            // Nothing was sent to Hyperswitch, so this is a definite failure.
            return failed(kbPaymentId, kbTransactionId, type, amount, currency, PaymentPluginStatus.ERROR,
                    "NO_HYPERSWITCH_PAYMENT_METHOD",
                    "Payment method has no hyperswitch:<customer_id>:<payment_method_id> external key");
        }

        final String paymentId = paymentIdFor(kbTransactionId);
        final JsonObject req = new JsonObject();
        req.addProperty("payment_id", paymentId);
        req.addProperty("amount", toMinor(amount, currency));
        req.addProperty("currency", currency.name());
        req.addProperty("customer_id", refs[0]);
        req.addProperty("confirm", true);
        req.addProperty("off_session", true);
        req.addProperty("capture_method", type == TransactionType.AUTHORIZE ? "manual" : "automatic");
        final JsonObject recurring = new JsonObject();
        recurring.addProperty("type", "payment_method_id");
        recurring.addProperty("data", refs[1]);
        req.add("recurring_details", recurring);
        final JsonObject metadata = new JsonObject();
        metadata.addProperty("kb_account_id", String.valueOf(kbAccountId));
        metadata.addProperty("kb_payment_id", String.valueOf(kbPaymentId));
        metadata.addProperty("kb_transaction_id", String.valueOf(kbTransactionId));
        req.add("metadata", metadata);

        try {
            return fromPayment(client.createPayment(req), kbPaymentId, kbTransactionId, type);
        } catch (final HyperswitchClient.ApiError e) {
            // A retry of a request Hyperswitch already has collides on
            // payment_id; the existing payment is the answer.
            final PaymentTransactionInfoPlugin existing = tryRetrievePayment(paymentId, kbPaymentId, kbTransactionId, type);
            if (existing != null) return existing;
            final PaymentPluginStatus status = e.status >= 500 ? PaymentPluginStatus.UNDEFINED : PaymentPluginStatus.ERROR;
            return failed(kbPaymentId, kbTransactionId, type, amount, currency, status, e.code(), e.message());
        } catch (final IOException e) {
            // The request may or may not have reached Hyperswitch.
            final PaymentTransactionInfoPlugin existing = tryRetrievePayment(paymentId, kbPaymentId, kbTransactionId, type);
            if (existing != null) return existing;
            return failed(kbPaymentId, kbTransactionId, type, amount, currency, PaymentPluginStatus.UNDEFINED,
                    "NETWORK_ERROR", e.getMessage());
        }
    }

    @Override
    public PaymentTransactionInfoPlugin capturePayment(final UUID kbAccountId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                       final UUID kbPaymentMethodId, final BigDecimal amount, final Currency currency,
                                                       final Iterable<PluginProperty> properties, final CallContext context) {
        final String authId = originalPaymentId(kbPaymentId, context, TransactionType.AUTHORIZE);
        if (authId == null) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.CAPTURE, amount, currency, PaymentPluginStatus.ERROR,
                    "NO_AUTHORIZATION", "No authorisation found on this payment");
        }
        try {
            return fromPayment(client.capturePayment(authId, toMinor(amount, currency)), kbPaymentId, kbTransactionId, TransactionType.CAPTURE);
        } catch (final HyperswitchClient.ApiError e) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.CAPTURE, amount, currency,
                    e.status >= 500 ? PaymentPluginStatus.UNDEFINED : PaymentPluginStatus.ERROR, e.code(), e.message());
        } catch (final IOException e) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.CAPTURE, amount, currency, PaymentPluginStatus.UNDEFINED,
                    "NETWORK_ERROR", e.getMessage());
        }
    }

    @Override
    public PaymentTransactionInfoPlugin voidPayment(final UUID kbAccountId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                    final UUID kbPaymentMethodId, final Iterable<PluginProperty> properties,
                                                    final CallContext context) {
        final String authId = originalPaymentId(kbPaymentId, context, TransactionType.AUTHORIZE);
        if (authId == null) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.VOID, null, null, PaymentPluginStatus.ERROR,
                    "NO_AUTHORIZATION", "No authorisation found on this payment");
        }
        try {
            return fromPayment(client.cancelPayment(authId), kbPaymentId, kbTransactionId, TransactionType.VOID);
        } catch (final HyperswitchClient.ApiError e) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.VOID, null, null,
                    e.status >= 500 ? PaymentPluginStatus.UNDEFINED : PaymentPluginStatus.ERROR, e.code(), e.message());
        } catch (final IOException e) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.VOID, null, null, PaymentPluginStatus.UNDEFINED,
                    "NETWORK_ERROR", e.getMessage());
        }
    }

    @Override
    public PaymentTransactionInfoPlugin refundPayment(final UUID kbAccountId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                      final UUID kbPaymentMethodId, final BigDecimal amount, final Currency currency,
                                                      final Iterable<PluginProperty> properties, final CallContext context) {
        String original = originalPaymentId(kbPaymentId, context, TransactionType.PURCHASE);
        if (original == null) original = originalPaymentId(kbPaymentId, context, TransactionType.AUTHORIZE);
        if (original == null) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.REFUND, amount, currency, PaymentPluginStatus.ERROR,
                    "NO_ORIGINAL_PAYMENT", "No purchase or authorisation found on this payment");
        }
        final String refundId = refundIdFor(kbTransactionId);
        final JsonObject req = new JsonObject();
        req.addProperty("payment_id", original);
        req.addProperty("refund_id", refundId);
        req.addProperty("amount", toMinor(amount, currency));
        req.addProperty("reason", "Refunded in Kill Bill");
        final JsonObject metadata = new JsonObject();
        metadata.addProperty("kb_payment_id", String.valueOf(kbPaymentId));
        metadata.addProperty("kb_transaction_id", String.valueOf(kbTransactionId));
        req.add("metadata", metadata);
        try {
            return fromRefund(client.createRefund(req), kbPaymentId, kbTransactionId);
        } catch (final HyperswitchClient.ApiError e) {
            final PaymentTransactionInfoPlugin existing = tryRetrieveRefund(refundId, kbPaymentId, kbTransactionId);
            if (existing != null) return existing;
            return failed(kbPaymentId, kbTransactionId, TransactionType.REFUND, amount, currency,
                    e.status >= 500 ? PaymentPluginStatus.UNDEFINED : PaymentPluginStatus.ERROR, e.code(), e.message());
        } catch (final IOException e) {
            final PaymentTransactionInfoPlugin existing = tryRetrieveRefund(refundId, kbPaymentId, kbTransactionId);
            if (existing != null) return existing;
            return failed(kbPaymentId, kbTransactionId, TransactionType.REFUND, amount, currency, PaymentPluginStatus.UNDEFINED,
                    "NETWORK_ERROR", e.getMessage());
        }
    }

    @Override
    public PaymentTransactionInfoPlugin creditPayment(final UUID kbAccountId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                      final UUID kbPaymentMethodId, final BigDecimal amount, final Currency currency,
                                                      final Iterable<PluginProperty> properties, final CallContext context)
            throws PaymentPluginApiException {
        // A credit pays money out to a customer without an original payment;
        // that is a payout, which this plugin does not do.
        throw new PaymentPluginApiException("UNSUPPORTED", "Credits (payouts) are not supported by " + PLUGIN_NAME);
    }

    /** Kill Bill's janitor calls this to settle PENDING / UNDEFINED transactions. */
    @Override
    public List<PaymentTransactionInfoPlugin> getPaymentInfo(final UUID kbAccountId, final UUID kbPaymentId,
                                                             final Iterable<PluginProperty> properties, final TenantContext context)
            throws PaymentPluginApiException {
        final List<KillbillLookups.Txn> txns;
        try {
            txns = lookups.transactions(kbPaymentId, context);
        } catch (final Exception e) {
            throw new PaymentPluginApiException("KILLBILL_LOOKUP_FAILED", e);
        }
        String authId = null;
        for (final KillbillLookups.Txn t : txns) {
            if (t.type == TransactionType.AUTHORIZE) authId = paymentIdFor(t.id);
        }

        final List<PaymentTransactionInfoPlugin> out = new ArrayList<>();
        for (final KillbillLookups.Txn t : txns) {
            final PaymentTransactionInfoPlugin info;
            switch (t.type) {
                case PURCHASE:
                case AUTHORIZE:
                    info = readPayment(paymentIdFor(t.id), kbPaymentId, t.id, t.type);
                    break;
                case CAPTURE:
                case VOID:
                    info = authId != null ? readPayment(authId, kbPaymentId, t.id, t.type) : null;
                    break;
                case REFUND:
                    info = readRefund(refundIdFor(t.id), kbPaymentId, t.id);
                    break;
                default:
                    info = null;
            }
            if (info != null) out.add(info);
        }
        return out;
    }

    // ── Reading back ────────────────────────────────────────────────────────

    private PaymentTransactionInfoPlugin readPayment(final String paymentId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                     final TransactionType type) {
        try {
            return fromPayment(client.retrievePayment(paymentId), kbPaymentId, kbTransactionId, type);
        } catch (final HyperswitchClient.ApiError e) {
            if (e.status == 404 && (type == TransactionType.PURCHASE || type == TransactionType.AUTHORIZE)) {
                // Never reached Hyperswitch: nothing was charged.
                return failed(kbPaymentId, kbTransactionId, type, null, null, PaymentPluginStatus.ERROR,
                        "NOT_FOUND_AT_GATEWAY", "Hyperswitch has no payment " + paymentId);
            }
            return failed(kbPaymentId, kbTransactionId, type, null, null, PaymentPluginStatus.UNDEFINED, e.code(), e.message());
        } catch (final IOException e) {
            return failed(kbPaymentId, kbTransactionId, type, null, null, PaymentPluginStatus.UNDEFINED, "NETWORK_ERROR", e.getMessage());
        }
    }

    private PaymentTransactionInfoPlugin readRefund(final String refundId, final UUID kbPaymentId, final UUID kbTransactionId) {
        try {
            return fromRefund(client.retrieveRefund(refundId), kbPaymentId, kbTransactionId);
        } catch (final HyperswitchClient.ApiError e) {
            if (e.status == 404) {
                return failed(kbPaymentId, kbTransactionId, TransactionType.REFUND, null, null, PaymentPluginStatus.ERROR,
                        "NOT_FOUND_AT_GATEWAY", "Hyperswitch has no refund " + refundId);
            }
            return failed(kbPaymentId, kbTransactionId, TransactionType.REFUND, null, null, PaymentPluginStatus.UNDEFINED, e.code(), e.message());
        } catch (final IOException e) {
            return failed(kbPaymentId, kbTransactionId, TransactionType.REFUND, null, null, PaymentPluginStatus.UNDEFINED, "NETWORK_ERROR", e.getMessage());
        }
    }

    private PaymentTransactionInfoPlugin tryRetrievePayment(final String paymentId, final UUID kbPaymentId, final UUID kbTransactionId,
                                                            final TransactionType type) {
        try {
            return fromPayment(client.retrievePayment(paymentId), kbPaymentId, kbTransactionId, type);
        } catch (final Exception e) {
            return null;
        }
    }

    private PaymentTransactionInfoPlugin tryRetrieveRefund(final String refundId, final UUID kbPaymentId, final UUID kbTransactionId) {
        try {
            return fromRefund(client.retrieveRefund(refundId), kbPaymentId, kbTransactionId);
        } catch (final Exception e) {
            return null;
        }
    }

    /** The Hyperswitch payment id of the first transaction of the given type on a Kill Bill payment. */
    private String originalPaymentId(final UUID kbPaymentId, final TenantContext context, final TransactionType wanted) {
        try {
            for (final KillbillLookups.Txn t : lookups.transactions(kbPaymentId, context)) {
                if (t.type == wanted) return paymentIdFor(t.id);
            }
        } catch (final Exception e) {
            LOG.log(Level.WARNING, "could not read transactions of payment " + kbPaymentId, e);
        }
        return null;
    }

    // ── Mapping ─────────────────────────────────────────────────────────────

    static TxnInfo fromPayment(final JsonObject p, final UUID kbPaymentId, final UUID kbTransactionId, final TransactionType type) {
        final Currency currency = currencyOf(p);
        final String amountField = type == TransactionType.CAPTURE || type == TransactionType.PURCHASE ? "amount_received" : "amount";
        Long minor = longOf(p, amountField);
        if (minor == null) minor = longOf(p, "amount");
        final PaymentPluginStatus status = paymentStatus(str(p, "status"), type);
        return new TxnInfo(kbPaymentId, kbTransactionId, type,
                minor != null && currency != null ? fromMinor(minor, currency) : null, currency, status,
                str(p, "error_message"), str(p, "error_code"),
                str(p, "payment_id"), str(p, "connector_transaction_id"),
                dateOf(p, "created"), props("hyperswitch_status", str(p, "status")));
    }

    static TxnInfo fromRefund(final JsonObject r, final UUID kbPaymentId, final UUID kbTransactionId) {
        final Currency currency = currencyOf(r);
        final Long minor = longOf(r, "amount");
        return new TxnInfo(kbPaymentId, kbTransactionId, TransactionType.REFUND,
                minor != null && currency != null ? fromMinor(minor, currency) : null, currency, refundStatus(str(r, "status")),
                str(r, "error_message"), str(r, "error_code"),
                str(r, "refund_id"), str(r, "payment_id"),
                dateOf(r, "created_at"), props("hyperswitch_status", str(r, "status")));
    }

    private static TxnInfo failed(final UUID kbPaymentId, final UUID kbTransactionId, final TransactionType type,
                                  final BigDecimal amount, final Currency currency, final PaymentPluginStatus status,
                                  final String code, final String message) {
        return new TxnInfo(kbPaymentId, kbTransactionId, type, amount, currency, status, message, code,
                null, null, DateTime.now(DateTimeZone.UTC), Collections.emptyList());
    }

    private static String str(final JsonObject o, final String key) {
        final JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? null : e.getAsString();
    }

    private static Long longOf(final JsonObject o, final String key) {
        final JsonElement e = o.get(key);
        if (e == null || e.isJsonNull()) return null;
        try {
            return e.getAsLong();
        } catch (final RuntimeException ex) {
            return null;
        }
    }

    private static Currency currencyOf(final JsonObject o) {
        final String c = str(o, "currency");
        if (c == null) return null;
        try {
            return Currency.valueOf(c);
        } catch (final IllegalArgumentException e) {
            return null;
        }
    }

    private static DateTime dateOf(final JsonObject o, final String key) {
        final String s = str(o, key);
        if (s == null) return DateTime.now(DateTimeZone.UTC);
        try {
            // Hyperswitch serialises a zone-less UTC timestamp.
            return new DateTime(s.endsWith("Z") || s.matches(".*[+-]\\d{2}:?\\d{2}$") ? s : s + "Z", DateTimeZone.UTC);
        } catch (final IllegalArgumentException e) {
            return DateTime.now(DateTimeZone.UTC);
        }
    }

    private static List<PluginProperty> props(final String key, final String value) {
        return value == null ? Collections.emptyList()
                : Collections.singletonList(new PluginProperty(key, value, false));
    }

    // ── PaymentPluginApi: payment methods ───────────────────────────────────
    //
    // The card lives in Hyperswitch's vault; Kill Bill only holds the
    // reference in the payment method's external key. There is nothing for
    // the plugin itself to store.

    @Override
    public void addPaymentMethod(final UUID kbAccountId, final UUID kbPaymentMethodId, final PaymentMethodPlugin paymentMethodProps,
                                 final boolean setDefault, final Iterable<PluginProperty> properties, final CallContext context) {
        // Validated at charge time: a payment method without a well-formed
        // external key fails its payments with NO_HYPERSWITCH_PAYMENT_METHOD.
    }

    @Override
    public void deletePaymentMethod(final UUID kbAccountId, final UUID kbPaymentMethodId,
                                    final Iterable<PluginProperty> properties, final CallContext context) {
        // The saved card stays in the Hyperswitch vault; removing it there is
        // a customer action, not a side effect of Kill Bill housekeeping.
    }

    @Override
    public PaymentMethodPlugin getPaymentMethodDetail(final UUID kbAccountId, final UUID kbPaymentMethodId,
                                                      final Iterable<PluginProperty> properties, final TenantContext context) {
        String external = null;
        try {
            external = lookups.paymentMethodExternalKey(kbPaymentMethodId, context);
        } catch (final Exception e) {
            LOG.log(Level.FINE, "could not read payment method " + kbPaymentMethodId, e);
        }
        final String[] refs = parseExternalKey(external);
        final String pmId = refs != null ? refs[1] : null;
        return new PaymentMethodPlugin() {
            @Override public UUID getKbPaymentMethodId() { return kbPaymentMethodId; }
            @Override public String getExternalPaymentMethodId() { return pmId; }
            @Override public boolean isDefaultPaymentMethod() { return false; }
            @Override public List<PluginProperty> getProperties() { return Collections.emptyList(); }
        };
    }

    @Override
    public void setDefaultPaymentMethod(final UUID kbAccountId, final UUID kbPaymentMethodId,
                                        final Iterable<PluginProperty> properties, final CallContext context) {
    }

    @Override
    public List<PaymentMethodInfoPlugin> getPaymentMethods(final UUID kbAccountId, final boolean refreshFromGateway,
                                                           final Iterable<PluginProperty> properties, final CallContext context) {
        return Collections.emptyList();
    }

    @Override
    public void resetPaymentMethods(final UUID kbAccountId, final List<PaymentMethodInfoPlugin> paymentMethods,
                                    final Iterable<PluginProperty> properties, final CallContext context) {
    }

    // ── PaymentPluginApi: not supported ─────────────────────────────────────

    @Override
    public Pagination<PaymentTransactionInfoPlugin> searchPayments(final String searchKey, final Long offset, final Long limit,
                                                                   final Iterable<PluginProperty> properties, final TenantContext context)
            throws PaymentPluginApiException {
        throw new PaymentPluginApiException("UNSUPPORTED", "Search is not supported by " + PLUGIN_NAME);
    }

    @Override
    public Pagination<PaymentMethodPlugin> searchPaymentMethods(final String searchKey, final Long offset, final Long limit,
                                                                final Iterable<PluginProperty> properties, final TenantContext context)
            throws PaymentPluginApiException {
        throw new PaymentPluginApiException("UNSUPPORTED", "Search is not supported by " + PLUGIN_NAME);
    }

    @Override
    public HostedPaymentPageFormDescriptor buildFormDescriptor(final UUID kbAccountId, final Iterable<PluginProperty> customFields,
                                                               final Iterable<PluginProperty> properties, final CallContext context)
            throws PaymentPluginApiException {
        // Cards are collected by checkout (unified-router + Hyperswitch SDK), not by Kill Bill.
        throw new PaymentPluginApiException("UNSUPPORTED", "Hosted payment pages are not provided by " + PLUGIN_NAME);
    }

    @Override
    public GatewayNotification processNotification(final String notification, final Iterable<PluginProperty> properties,
                                                   final CallContext context) throws PaymentPluginApiException {
        // Hyperswitch webhooks go to unified-router; Kill Bill learns final
        // states through getPaymentInfo (the janitor) instead.
        throw new PaymentPluginApiException("UNSUPPORTED", "Notifications are not processed by " + PLUGIN_NAME);
    }
}
