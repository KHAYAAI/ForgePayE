package io.forgepay.killbill;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.PluginProperty;
import org.killbill.billing.payment.plugin.api.PaymentPluginApiException;
import org.killbill.billing.util.callcontext.CallContext;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

/**
 * Integration tests for ForgepayPaymentPlugin.
 * Uses MockWebServer to simulate Hyperswitch API responses.
 */
public class ForgepayPaymentPluginTest {

    private MockWebServer mockWebServer;
    private ForgepayPaymentPlugin plugin;
    private ForgepayPluginConfig config;
    private UUID accountId;
    private UUID paymentId;
    private UUID transactionId;
    private UUID paymentMethodId;
    private CallContext context;

    @BeforeEach
    public void setUp() throws Exception {
        // Set up mock Hyperswitch server
        mockWebServer = new MockWebServer();
        mockWebServer.start();

        String baseUrl = "http://localhost:" + mockWebServer.getPort();

        // Set environment variables for config
        System.setProperty("HYPERSWITCH_API_URL", baseUrl);
        System.setProperty("HYPERSWITCH_API_KEY", "test-api-key");
        System.setProperty("KILLBILL_HYPERSWITCH_WEBHOOK_SECRET", "test-secret");

        // Create plugin instance
        config = new ForgepayPluginConfig();
        plugin = new ForgepayPaymentPlugin();

        // Test identifiers
        accountId = UUID.randomUUID();
        paymentId = UUID.randomUUID();
        transactionId = UUID.randomUUID();
        paymentMethodId = UUID.randomUUID();
        context = mock(CallContext.class);
    }

    @AfterEach
    public void tearDown() throws Exception {
        mockWebServer.shutdown();
    }

    @Test
    public void testAuthorizePaymentSuccess() throws Exception {
        // Mock Hyperswitch response
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"," +
                "\"amount\": 500" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        // Execute authorization
        BigDecimal amount = new BigDecimal("5.00");
        var response = plugin.authorizePayment(
                accountId, paymentId, transactionId, paymentMethodId,
                amount, Currency.USD, null, context);

        // Verify response
        assertThat(response).isNotNull();
        assertThat(response.getFirstPaymentReferenceId()).isEqualTo("pay_123456789");
        assertThat(response.isSuccess()).isTrue();

        // Verify API call was made
        assertThat(mockWebServer.getRequestCount()).isEqualTo(1);
    }

    @Test
    public void testAuthorizePaymentPending() throws Exception {
        // Mock pending payment response
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"processing\"," +
                "\"amount\": 500" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        BigDecimal amount = new BigDecimal("5.00");
        var response = plugin.authorizePayment(
                accountId, paymentId, transactionId, paymentMethodId,
                amount, Currency.USD, null, context);

        assertThat(response).isNotNull();
        assertThat(response.isSuccess()).isFalse();
    }

    @Test
    public void testAuthorizePaymentFailure() throws Exception {
        // Mock failed payment response
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"failed\"," +
                "\"error_message\": \"Insufficient funds\"," +
                "\"amount\": 500" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        BigDecimal amount = new BigDecimal("5.00");
        var response = plugin.authorizePayment(
                accountId, paymentId, transactionId, paymentMethodId,
                amount, Currency.USD, null, context);

        assertThat(response).isNotNull();
        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getGatewayError()).isEqualTo("Insufficient funds");
    }

    @Test
    public void testCapturePaymentSuccess() throws Exception {
        // Mock capture response
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"," +
                "\"amount\": 500" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        BigDecimal amount = new BigDecimal("5.00");
        var properties = (Iterable<PluginProperty>) (Iterable<?>) Arrays.asList(
                new TestPluginProperty("externalPaymentId", "pay_123456789")
        );
        var response = plugin.capturePayment(
                accountId, paymentId, transactionId, paymentMethodId,
                amount, Currency.USD, properties, context);

        assertThat(response).isNotNull();
        assertThat(response.isSuccess()).isTrue();
    }

    @Test
    public void testRefundPaymentSuccess() throws Exception {
        // Mock refund response
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"," +
                "\"refunds\": [{\"id\": \"ref_987654321\"}]" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        BigDecimal refundAmount = new BigDecimal("2.50");
        var properties = (Iterable<PluginProperty>) (Iterable<?>) Arrays.asList(
                new TestPluginProperty("externalPaymentId", "pay_123456789")
        );
        var response = plugin.refundPayment(
                accountId, paymentId, transactionId, paymentMethodId,
                refundAmount, Currency.USD, properties, context);

        assertThat(response).isNotNull();
        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getSecondPaymentReferenceId()).isEqualTo("ref_987654321");
    }

    @Test
    public void testRefundPaymentFailure() throws Exception {
        // Mock refund failure
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"failed\"," +
                "\"error_message\": \"Payment already refunded\"" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        BigDecimal refundAmount = new BigDecimal("5.00");
        var properties = (Iterable<PluginProperty>) (Iterable<?>) Arrays.asList(
                new TestPluginProperty("externalPaymentId", "pay_123456789")
        );
        var response = plugin.refundPayment(
                accountId, paymentId, transactionId, paymentMethodId,
                refundAmount, Currency.USD, properties, context);

        assertThat(response).isNotNull();
        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getGatewayError()).contains("already refunded");
    }

    @Test
    public void testVoidPaymentSuccess() throws Exception {
        // Mock void response
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"," +
                "\"refunds\": [{\"id\": \"ref_void_123\"}]" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        var properties = (Iterable<PluginProperty>) (Iterable<?>) Arrays.asList(
                new TestPluginProperty("externalPaymentId", "pay_123456789")
        );
        var response = plugin.voidPayment(
                accountId, paymentId, transactionId, paymentMethodId,
                properties, context);

        assertThat(response).isNotNull();
        assertThat(response.isSuccess()).isTrue();
    }

    @Test
    public void testGetPaymentInfoSuccess() throws Exception {
        // Mock payment info response
        String mockResponse = "{" +
                "\"id\": \"pay_123456789\"," +
                "\"status\": \"succeeded\"," +
                "\"amount\": 500" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        var properties = (Iterable<PluginProperty>) (Iterable<?>) Arrays.asList(
                new TestPluginProperty("externalPaymentId", "pay_123456789")
        );
        var response = plugin.getPaymentInfo(
                accountId, paymentId, transactionId, properties, context);

        assertThat(response).isNotNull();
        assertThat(response.getFirstPaymentReferenceId()).isEqualTo("pay_123456789");
    }

    @Test
    public void testPaymentWithEurosCurrency() throws Exception {
        // Test EUR currency conversion (€ uses 2 decimal places like USD)
        String mockResponse = "{" +
                "\"id\": \"pay_eur_123\"," +
                "\"status\": \"succeeded\"," +
                "\"amount\": 470," +
                "\"currency\": \"EUR\"" +
                "}";

        mockWebServer.enqueue(new MockResponse()
                .setBody(mockResponse)
                .addHeader("Content-Type", "application/json"));

        BigDecimal amount = new BigDecimal("4.70");
        var response = plugin.authorizePayment(
                accountId, paymentId, transactionId, paymentMethodId,
                amount, Currency.EUR, null, context);

        assertThat(response).isNotNull();
        assertThat(response.isSuccess()).isTrue();
    }

    @Test
    public void testIdempotencyKeyGeneration() {
        // Verify idempotency keys are deterministic
        IdempotencyKeyGenerator keyGen = new IdempotencyKeyGenerator();
        UUID testId1 = UUID.fromString("550e8400-e29b-41d4-a716-446655440000");
        UUID testId2 = UUID.fromString("550e8400-e29b-41d4-a716-446655440000");

        String key1 = keyGen.generate(testId1, testId2, "authorize");
        String key2 = keyGen.generate(testId1, testId2, "authorize");

        assertThat(key1).isEqualTo(key2);
        assertThat(key1).contains("authorize");
        assertThat(key1.length()).isLessThanOrEqualTo(64);
    }

    @Test
    public void testIdempotencyKeyDifferentForDifferentOperations() {
        // Verify different operations produce different keys
        IdempotencyKeyGenerator keyGen = new IdempotencyKeyGenerator();
        UUID testId1 = UUID.randomUUID();
        UUID testId2 = UUID.randomUUID();

        String authKey = keyGen.generate(testId1, testId2, "authorize");
        String captureKey = keyGen.generate(testId1, testId2, "capture");
        String refundKey = keyGen.generate(testId1, testId2, "refund");

        assertThat(authKey).isNotEqualTo(captureKey);
        assertThat(captureKey).isNotEqualTo(refundKey);
    }
}
