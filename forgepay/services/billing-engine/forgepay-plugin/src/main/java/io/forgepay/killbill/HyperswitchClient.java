package io.forgepay.killbill;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * HTTP client for communicating with Hyperswitch payment router.
 * Handles payment initiation, capture, refund, and status checks.
 */
public class HyperswitchClient {

    private static final Logger logger = LoggerFactory.getLogger(HyperswitchClient.class);
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    private final OkHttpClient httpClient;
    private final String baseUrl;
    private final String apiKey;

    public HyperswitchClient(ForgepayPluginConfig config) {
        this.baseUrl = config.getHyperswitchUrl();
        this.apiKey = config.getHyperswitchApiKey();

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(config.getConnectionTimeoutMs(), TimeUnit.MILLISECONDS)
                .readTimeout(config.getReadTimeoutMs(), TimeUnit.MILLISECONDS)
                .writeTimeout(config.getReadTimeoutMs(), TimeUnit.MILLISECONDS)
                .build();

        logger.info("HyperswitchClient initialized: url={}", baseUrl);
    }

    /**
     * Initiates a payment via Hyperswitch.
     * Creates a POST request to /v1/charges with payment details.
     *
     * @param customerId Customer ID for payment method lookup
     * @param amountCents Amount in cents (or currency's smallest unit)
     * @param currency Currency code (USD, EUR, GBP)
     * @param orderId Order/invoice ID for idempotency
     * @param idempotencyKey Unique key to ensure idempotent payment
     * @return HyperswitchPaymentResponse with payment ID and status
     * @throws ForgepayPaymentException if payment initiation fails
     */
    public HyperswitchPaymentResponse initiatePayment(
            String customerId,
            long amountCents,
            String currency,
            String orderId,
            String idempotencyKey) throws ForgepayPaymentException {

        try {
            JsonObject payload = new JsonObject();
            payload.addProperty("amount", amountCents);
            payload.addProperty("currency", currency);
            payload.addProperty("customer_id", customerId);
            payload.addProperty("order_id", orderId);
            payload.addProperty("confirm", true);
            payload.addProperty("off_session", true); // Recurring payment

            logger.debug("Initiating payment to Hyperswitch: customerId={}, amount={}, orderId={}",
                    customerId, amountCents, orderId);

            HyperswitchPaymentResponse response = post(
                    "/v1/charges",
                    payload.toString(),
                    idempotencyKey);

            logger.info("Payment initiated successfully: paymentId={}, status={}",
                    response.getPaymentId(), response.getStatus());

            return response;

        } catch (IOException e) {
            logger.error("Network error initiating payment", e);
            throw new ForgepayPaymentException("NETWORK_ERROR",
                    "Failed to initiate payment: " + e.getMessage(), e);
        }
    }

    /**
     * Captures a previously authorized payment.
     *
     * @param paymentId Payment ID from Hyperswitch
     * @param amountCents Amount to capture (should match authorized amount)
     * @param idempotencyKey Unique key for idempotency
     * @return Updated HyperswitchPaymentResponse
     * @throws ForgepayPaymentException if capture fails
     */
    public HyperswitchPaymentResponse capturePayment(
            String paymentId,
            long amountCents,
            String idempotencyKey) throws ForgepayPaymentException {

        try {
            JsonObject payload = new JsonObject();
            payload.addProperty("amount_to_capture", amountCents);

            logger.debug("Capturing payment: paymentId={}, amount={}", paymentId, amountCents);

            HyperswitchPaymentResponse response = post(
                    "/v1/charges/" + paymentId + "/capture",
                    payload.toString(),
                    idempotencyKey);

            logger.info("Payment captured successfully: paymentId={}, status={}",
                    response.getPaymentId(), response.getStatus());

            return response;

        } catch (IOException e) {
            logger.error("Network error capturing payment", e);
            throw new ForgepayPaymentException("CAPTURE_FAILED",
                    "Failed to capture payment: " + e.getMessage(), e);
        }
    }

    /**
     * Refunds a previously captured payment.
     *
     * @param paymentId Payment ID from Hyperswitch
     * @param amountCents Amount to refund (partial or full)
     * @param reason Reason for refund
     * @param idempotencyKey Unique key for idempotency
     * @return HyperswitchPaymentResponse with refund status
     * @throws ForgepayPaymentException if refund fails
     */
    public HyperswitchPaymentResponse refundPayment(
            String paymentId,
            long amountCents,
            String reason,
            String idempotencyKey) throws ForgepayPaymentException {

        try {
            JsonObject payload = new JsonObject();
            payload.addProperty("amount", amountCents);
            payload.addProperty("reason", reason);

            logger.debug("Refunding payment: paymentId={}, amount={}, reason={}",
                    paymentId, amountCents, reason);

            HyperswitchPaymentResponse response = post(
                    "/v1/charges/" + paymentId + "/refunds",
                    payload.toString(),
                    idempotencyKey);

            logger.info("Payment refunded successfully: paymentId={}, refundId={}",
                    response.getPaymentId(), response.getRefundId());

            return response;

        } catch (IOException e) {
            logger.error("Network error refunding payment", e);
            throw new ForgepayPaymentException("REFUND_FAILED",
                    "Failed to refund payment: " + e.getMessage(), e);
        }
    }

    /**
     * Retrieves payment information from Hyperswitch.
     *
     * @param paymentId Payment ID from Hyperswitch
     * @return HyperswitchPaymentResponse with current status
     * @throws ForgepayPaymentException if retrieval fails
     */
    public HyperswitchPaymentResponse getPaymentInfo(String paymentId)
            throws ForgepayPaymentException {

        try {
            logger.debug("Retrieving payment info: paymentId={}", paymentId);

            Request request = new Request.Builder()
                    .url(baseUrl + "/v1/charges/" + paymentId)
                    .addHeader("Authorization", "Bearer " + apiKey)
                    .addHeader("Content-Type", "application/json")
                    .get()
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    throw new ForgepayPaymentException("PAYMENT_INFO_FAILED",
                            "Failed to retrieve payment info: " + response.code());
                }

                String body = response.body().string();
                JsonObject json = JsonParser.parseString(body).getAsJsonObject();

                HyperswitchPaymentResponse paymentResponse = parsePaymentResponse(json);
                logger.info("Payment info retrieved: paymentId={}, status={}",
                        paymentResponse.getPaymentId(), paymentResponse.getStatus());

                return paymentResponse;
            }

        } catch (IOException e) {
            logger.error("Network error retrieving payment info", e);
            throw new ForgepayPaymentException("NETWORK_ERROR",
                    "Failed to retrieve payment info: " + e.getMessage(), e);
        }
    }

    /**
     * Makes a POST request to Hyperswitch with idempotency support.
     *
     * @param endpoint API endpoint (e.g., /v1/charges)
     * @param body JSON request body
     * @param idempotencyKey Unique key for idempotency
     * @return Parsed payment response
     * @throws IOException if request fails
     * @throws ForgepayPaymentException if response indicates error
     */
    private HyperswitchPaymentResponse post(String endpoint, String body, String idempotencyKey)
            throws IOException, ForgepayPaymentException {

        Request request = new Request.Builder()
                .url(baseUrl + endpoint)
                .addHeader("Authorization", "Bearer " + apiKey)
                .addHeader("Content-Type", "application/json")
                .addHeader("Idempotency-Key", idempotencyKey)
                .post(RequestBody.create(body, JSON))
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body().string();

            if (!response.isSuccessful()) {
                logger.error("Hyperswitch API error: status={}, body={}", response.code(), responseBody);
                throw new ForgepayPaymentException("API_ERROR",
                        "Hyperswitch API returned " + response.code() + ": " + responseBody);
            }

            JsonObject json = JsonParser.parseString(responseBody).getAsJsonObject();

            // Check for error in response body
            if (json.has("error")) {
                String errorMsg = json.get("error").getAsString();
                throw new ForgepayPaymentException("PAYMENT_ERROR", errorMsg);
            }

            return parsePaymentResponse(json);
        }
    }

    /**
     * Parses Hyperswitch payment response JSON into typed object.
     *
     * @param json Response JSON from Hyperswitch
     * @return HyperswitchPaymentResponse
     */
    private HyperswitchPaymentResponse parsePaymentResponse(JsonObject json) {
        String paymentId = json.has("id") ? json.get("id").getAsString() : null;
        String status = json.has("status") ? json.get("status").getAsString() : null;
        String errorMsg = json.has("error_message") ? json.get("error_message").getAsString() : null;
        String refundId = null;

        if (json.has("refunds") && json.getAsJsonArray("refunds").size() > 0) {
            JsonElement firstRefund = json.getAsJsonArray("refunds").get(0);
            if (firstRefund.isJsonObject()) {
                refundId = firstRefund.getAsJsonObject().get("id").getAsString();
            }
        }

        return new HyperswitchPaymentResponse(paymentId, status, errorMsg, refundId);
    }

    /**
     * Closes the HTTP client and releases resources.
     */
    public void close() {
        httpClient.dispatcher().executorService().shutdown();
    }

    /**
     * Immutable response object from Hyperswitch.
     */
    public static class HyperswitchPaymentResponse {
        private final String paymentId;
        private final String status;
        private final String errorMessage;
        private final String refundId;

        public HyperswitchPaymentResponse(String paymentId, String status,
                String errorMessage, String refundId) {
            this.paymentId = paymentId;
            this.status = status;
            this.errorMessage = errorMessage;
            this.refundId = refundId;
        }

        public String getPaymentId() {
            return paymentId;
        }

        public String getStatus() {
            return status;
        }

        public String getErrorMessage() {
            return errorMessage;
        }

        public String getRefundId() {
            return refundId;
        }

        public boolean isSuccessful() {
            return "succeeded".equalsIgnoreCase(status);
        }

        public boolean isFailed() {
            return "failed".equalsIgnoreCase(status);
        }

        public boolean isPending() {
            return "pending".equalsIgnoreCase(status);
        }
    }
}
