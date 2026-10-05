package io.forgepay.killbill;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Minimal client for the Hyperswitch payments API.
 *
 * Routes and fields are taken from this repo's own Hyperswitch source
 * (crates/router/src/routes/app.rs, crates/api_models/src/payments.rs):
 *   POST /payments                    create (and confirm) a payment
 *   GET  /payments/{payment_id}       retrieve
 *   POST /payments/{id}/capture       capture an authorisation
 *   POST /payments/{id}/cancel        void an authorisation
 *   POST /refunds                     create a refund
 *   GET  /refunds/{refund_id}         retrieve a refund
 * Authentication is the merchant's secret key in the `api-key` header.
 *
 * The previous client posted to Stripe-style /v1/charges routes with a Bearer
 * token; Hyperswitch serves neither.
 */
public class HyperswitchClient {

    /** A non-2xx response from Hyperswitch, with its body. */
    public static final class ApiError extends Exception {
        public final int status;
        public final JsonObject body;

        ApiError(final int status, final JsonObject body) {
            super("Hyperswitch returned HTTP " + status);
            this.status = status;
            this.body = body;
        }

        /** Hyperswitch's error code, e.g. "IR_01", or null. */
        public String code() {
            final JsonObject err = body != null && body.has("error") && body.get("error").isJsonObject()
                    ? body.getAsJsonObject("error") : null;
            return err != null && err.has("code") ? err.get("code").getAsString() : null;
        }

        public String message() {
            final JsonObject err = body != null && body.has("error") && body.get("error").isJsonObject()
                    ? body.getAsJsonObject("error") : null;
            return err != null && err.has("message") ? err.get("message").getAsString() : getMessage();
        }
    }

    private final String baseUrl;
    private final String apiKey;
    private final HttpClient http;
    private final Duration timeout;

    public HyperswitchClient(final String baseUrl, final String apiKey) {
        this(baseUrl, apiKey, Duration.ofSeconds(30));
    }

    public HyperswitchClient(final String baseUrl, final String apiKey, final Duration timeout) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.timeout = timeout;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    public JsonObject createPayment(final JsonObject request) throws IOException, ApiError {
        return send("POST", "/payments", request);
    }

    public JsonObject retrievePayment(final String paymentId) throws IOException, ApiError {
        return send("GET", "/payments/" + enc(paymentId), null);
    }

    public JsonObject capturePayment(final String paymentId, final long amountMinor) throws IOException, ApiError {
        final JsonObject body = new JsonObject();
        body.addProperty("amount_to_capture", amountMinor);
        return send("POST", "/payments/" + enc(paymentId) + "/capture", body);
    }

    public JsonObject cancelPayment(final String paymentId) throws IOException, ApiError {
        final JsonObject body = new JsonObject();
        body.addProperty("cancellation_reason", "voided_in_kill_bill");
        return send("POST", "/payments/" + enc(paymentId) + "/cancel", body);
    }

    public JsonObject createRefund(final JsonObject request) throws IOException, ApiError {
        return send("POST", "/refunds", request);
    }

    public JsonObject retrieveRefund(final String refundId) throws IOException, ApiError {
        return send("GET", "/refunds/" + enc(refundId), null);
    }

    private JsonObject send(final String method, final String path, final JsonObject body) throws IOException, ApiError {
        final HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(timeout)
                .header("api-key", apiKey)
                .header("Accept", "application/json");
        if (body != null) {
            req.header("Content-Type", "application/json")
               .method(method, HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
        } else {
            req.method(method, HttpRequest.BodyPublishers.noBody());
        }

        final HttpResponse<String> res;
        try {
            res = http.send(req.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted", e);
        }

        final JsonObject json = parse(res.body());
        if (res.statusCode() < 200 || res.statusCode() >= 300) {
            throw new ApiError(res.statusCode(), json);
        }
        return json != null ? json : new JsonObject();
    }

    private static JsonObject parse(final String text) {
        if (text == null || text.isBlank()) return null;
        try {
            final JsonElement el = JsonParser.parseString(text);
            return el.isJsonObject() ? el.getAsJsonObject() : null;
        } catch (final RuntimeException e) {
            return null;
        }
    }

    private static String enc(final String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
