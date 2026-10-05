package io.forgepay.killbill;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.TransactionType;
import org.killbill.billing.payment.plugin.api.PaymentPluginStatus;
import org.killbill.billing.payment.plugin.api.PaymentTransactionInfoPlugin;
import org.killbill.billing.util.callcontext.TenantContext;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Runs the plugin against a fake Hyperswitch speaking the real routes and fields. */
class HyperswitchPaymentPluginApiTest {

    /** method + path → [status, body] */
    private final Map<String, String[]> routes = new HashMap<>();
    private final List<String> calls = new ArrayList<>();
    private final List<JsonObject> bodies = new ArrayList<>();
    private final List<String> apiKeys = new ArrayList<>();
    private HttpServer server;
    private HyperswitchPaymentPluginApi plugin;

    private String externalKey = "hyperswitch:cus_123:pm_456";
    private final Map<UUID, List<KillbillLookups.Txn>> kbTxns = new HashMap<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            final String key = ex.getRequestMethod() + " " + ex.getRequestURI().getPath();
            calls.add(key);
            apiKeys.add(ex.getRequestHeaders().getFirst("api-key"));
            final String in = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (!in.isEmpty()) bodies.add(JsonParser.parseString(in).getAsJsonObject());
            final String[] r = routes.getOrDefault(key, new String[]{"404", "{\"error\":{\"code\":\"HE_02\",\"message\":\"not found\"}}"});
            final byte[] out = r[1].getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(Integer.parseInt(r[0]), out.length);
            try (OutputStream os = ex.getResponseBody()) { os.write(out); }
        });
        server.start();

        final KillbillLookups lookups = new KillbillLookups() {
            @Override public String paymentMethodExternalKey(final UUID id, final TenantContext c) { return externalKey; }
            @Override public List<Txn> transactions(final UUID p, final TenantContext c) {
                return kbTxns.getOrDefault(p, Collections.emptyList());
            }
        };
        plugin = new HyperswitchPaymentPluginApi(
                new HyperswitchClient("http://127.0.0.1:" + server.getAddress().getPort(), "snd_test_key"), lookups);
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static String payment(final String id, final String status, final long amount, final long received) {
        return "{\"payment_id\":\"" + id + "\",\"status\":\"" + status + "\",\"amount\":" + amount
                + ",\"amount_received\":" + received + ",\"currency\":\"USD\",\"created\":\"2026-10-05T10:00:00.000\""
                + ",\"connector_transaction_id\":\"ch_1\"}";
    }

    @Test
    void purchaseSendsAnOffSessionPaymentAgainstTheSavedCard() {
        final UUID tx = UUID.randomUUID();
        routes.put("POST /payments", new String[]{"200", payment("kb_" + tx, "succeeded", 2800, 2800)});

        final PaymentTransactionInfoPlugin info = plugin.purchasePayment(
                UUID.randomUUID(), UUID.randomUUID(), tx, UUID.randomUUID(), new BigDecimal("28.00"), Currency.USD,
                Collections.emptyList(), null);

        assertEquals(List.of("POST /payments"), calls);
        assertEquals("snd_test_key", apiKeys.get(0));
        final JsonObject req = bodies.get(0);
        assertEquals("kb_" + tx, req.get("payment_id").getAsString());
        assertEquals(2800, req.get("amount").getAsLong());
        assertEquals("USD", req.get("currency").getAsString());
        assertEquals("cus_123", req.get("customer_id").getAsString());
        assertTrue(req.get("off_session").getAsBoolean());
        assertTrue(req.get("confirm").getAsBoolean());
        assertEquals("automatic", req.get("capture_method").getAsString());
        assertEquals("payment_method_id", req.getAsJsonObject("recurring_details").get("type").getAsString());
        assertEquals("pm_456", req.getAsJsonObject("recurring_details").get("data").getAsString());

        assertEquals(PaymentPluginStatus.PROCESSED, info.getStatus());
        assertEquals(0, new BigDecimal("28.00").compareTo(info.getAmount()));
        assertEquals("kb_" + tx, info.getFirstPaymentReferenceId());
        assertEquals(TransactionType.PURCHASE, info.getTransactionType());
    }

    @Test
    void aDeclineIsAnErrorWithTheGatewayCode() {
        final UUID tx = UUID.randomUUID();
        routes.put("POST /payments", new String[]{"200",
                "{\"payment_id\":\"kb_" + tx + "\",\"status\":\"failed\",\"amount\":2800,\"amount_received\":0,"
                        + "\"currency\":\"USD\",\"error_code\":\"card_declined\",\"error_message\":\"Insufficient funds\"}"});

        final PaymentTransactionInfoPlugin info = plugin.purchasePayment(
                UUID.randomUUID(), UUID.randomUUID(), tx, UUID.randomUUID(), new BigDecimal("28.00"), Currency.USD,
                Collections.emptyList(), null);

        assertEquals(PaymentPluginStatus.ERROR, info.getStatus());
        assertEquals("card_declined", info.getGatewayErrorCode());
        assertEquals("Insufficient funds", info.getGatewayError());
    }

    @Test
    void aPaymentMethodWithoutHyperswitchReferencesFailsWithoutCallingHyperswitch() {
        externalKey = "some-other-key";
        final PaymentTransactionInfoPlugin info = plugin.purchasePayment(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), BigDecimal.TEN, Currency.USD,
                Collections.emptyList(), null);

        assertEquals(PaymentPluginStatus.ERROR, info.getStatus());
        assertEquals("NO_HYPERSWITCH_PAYMENT_METHOD", info.getGatewayErrorCode());
        assertTrue(calls.isEmpty());
    }

    @Test
    void aRetriedPurchaseIsAnsweredByTheExistingPaymentNotChargedTwice() {
        final UUID tx = UUID.randomUUID();
        routes.put("POST /payments", new String[]{"400", "{\"error\":{\"code\":\"HE_01\",\"message\":\"duplicate payment\"}}"});
        routes.put("GET /payments/kb_" + tx, new String[]{"200", payment("kb_" + tx, "succeeded", 2800, 2800)});

        final PaymentTransactionInfoPlugin info = plugin.purchasePayment(
                UUID.randomUUID(), UUID.randomUUID(), tx, UUID.randomUUID(), new BigDecimal("28.00"), Currency.USD,
                Collections.emptyList(), null);

        assertEquals(PaymentPluginStatus.PROCESSED, info.getStatus());
        assertEquals(List.of("POST /payments", "GET /payments/kb_" + tx), calls);
    }

    @Test
    void aServerErrorWithNoRecordIsUndefinedForTheJanitor() {
        routes.put("POST /payments", new String[]{"503", "{}"});
        final PaymentTransactionInfoPlugin info = plugin.purchasePayment(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), BigDecimal.TEN, Currency.USD,
                Collections.emptyList(), null);
        assertEquals(PaymentPluginStatus.UNDEFINED, info.getStatus());
    }

    @Test
    void refundTargetsTheOriginalPurchaseWithADeterministicRefundId() {
        final UUID kbPayment = UUID.randomUUID();
        final UUID purchaseTx = UUID.randomUUID();
        final UUID refundTx = UUID.randomUUID();
        kbTxns.put(kbPayment, List.of(new KillbillLookups.Txn(purchaseTx, TransactionType.PURCHASE)));
        routes.put("POST /refunds", new String[]{"200",
                "{\"refund_id\":\"kbr_" + refundTx + "\",\"payment_id\":\"kb_" + purchaseTx + "\",\"amount\":1000,"
                        + "\"currency\":\"USD\",\"status\":\"pending\"}"});

        final PaymentTransactionInfoPlugin info = plugin.refundPayment(
                UUID.randomUUID(), kbPayment, refundTx, UUID.randomUUID(), BigDecimal.TEN, Currency.USD,
                Collections.emptyList(), null);

        final JsonObject req = bodies.get(0);
        assertEquals("kb_" + purchaseTx, req.get("payment_id").getAsString());
        assertEquals("kbr_" + refundTx, req.get("refund_id").getAsString());
        assertEquals(1000, req.get("amount").getAsLong());
        assertEquals(PaymentPluginStatus.PENDING, info.getStatus());
    }

    @Test
    void theJanitorReadsEveryTransactionBackByItsId() throws Exception {
        final UUID kbPayment = UUID.randomUUID();
        final UUID purchaseTx = UUID.randomUUID();
        final UUID refundTx = UUID.randomUUID();
        final UUID lostTx = UUID.randomUUID();
        kbTxns.put(kbPayment, List.of(
                new KillbillLookups.Txn(purchaseTx, TransactionType.PURCHASE),
                new KillbillLookups.Txn(refundTx, TransactionType.REFUND),
                new KillbillLookups.Txn(lostTx, TransactionType.PURCHASE)));
        routes.put("GET /payments/kb_" + purchaseTx, new String[]{"200", payment("kb_" + purchaseTx, "succeeded", 2800, 2800)});
        routes.put("GET /refunds/kbr_" + refundTx, new String[]{"200",
                "{\"refund_id\":\"kbr_" + refundTx + "\",\"amount\":500,\"currency\":\"USD\",\"status\":\"succeeded\"}"});

        final List<PaymentTransactionInfoPlugin> infos = plugin.getPaymentInfo(UUID.randomUUID(), kbPayment, Collections.emptyList(), null);

        assertEquals(3, infos.size());
        assertEquals(PaymentPluginStatus.PROCESSED, infos.get(0).getStatus());
        assertEquals(PaymentPluginStatus.PROCESSED, infos.get(1).getStatus());
        assertEquals(0, new BigDecimal("5.00").compareTo(infos.get(1).getAmount()));
        // Never reached Hyperswitch, so nothing was charged.
        assertEquals(PaymentPluginStatus.ERROR, infos.get(2).getStatus());
        assertEquals("NOT_FOUND_AT_GATEWAY", infos.get(2).getGatewayErrorCode());
    }

    @Test
    void authorizeUsesManualCaptureAndRequiresCaptureCountsAsAuthorised() {
        final UUID tx = UUID.randomUUID();
        routes.put("POST /payments", new String[]{"200", payment("kb_" + tx, "requires_capture", 2800, 0)});
        final PaymentTransactionInfoPlugin info = plugin.authorizePayment(
                UUID.randomUUID(), UUID.randomUUID(), tx, UUID.randomUUID(), new BigDecimal("28.00"), Currency.USD,
                Collections.emptyList(), null);
        assertEquals("manual", bodies.get(0).get("capture_method").getAsString());
        assertEquals(PaymentPluginStatus.PROCESSED, info.getStatus());
    }

    @Test
    void minorUnitsFollowTheCurrency() {
        assertEquals(2800, HyperswitchPaymentPluginApi.toMinor(new BigDecimal("28"), Currency.USD));
        assertEquals(4900, HyperswitchPaymentPluginApi.toMinor(new BigDecimal("4900"), Currency.JPY));
        assertEquals(0, new BigDecimal("49.00").compareTo(HyperswitchPaymentPluginApi.fromMinor(4900, Currency.USD)));
    }

    @Test
    void externalKeysMustNameACustomerAndAPaymentMethod() {
        assertEquals("cus_1", HyperswitchPaymentPluginApi.parseExternalKey("hyperswitch:cus_1:pm_2")[0]);
        assertNull(HyperswitchPaymentPluginApi.parseExternalKey("hyperswitch:cus_1"));
        assertNull(HyperswitchPaymentPluginApi.parseExternalKey("hyperswitch::pm_2"));
        assertNull(HyperswitchPaymentPluginApi.parseExternalKey(null));
    }
}
