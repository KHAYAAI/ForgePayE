package io.forgepay.killbill.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.prometheus.PrometheusConfig;
import io.micrometer.prometheus.PrometheusMeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Centralized registry for Prometheus metrics in the ForgePay Kill Bill plugin.
 * Provides thread-safe access to custom metrics for payment processing and webhooks.
 */
public class MetricsRegistry {
    private static final Logger logger = LoggerFactory.getLogger(MetricsRegistry.class);

    private static final AtomicReference<PrometheusMeterRegistry> registryHolder =
            new AtomicReference<>();

    private static volatile Timer paymentProcessingDurationTimer;
    private static volatile Counter paymentAttemptsCounter;
    private static volatile Counter webhookEventsProcessedCounter;
    private static volatile Timer webhookProcessingDurationTimer;

    private MetricsRegistry() {
        // Utility class, prevent instantiation
    }

    /**
     * Initializes the Prometheus meter registry and all metrics.
     * Must be called during plugin startup.
     * Thread-safe: idempotent on repeated calls.
     */
    public static synchronized void initialize() {
        if (registryHolder.get() != null) {
            logger.debug("MetricsRegistry already initialized");
            return;
        }

        try {
            PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
            registryHolder.set(registry);

            // Initialize payment processing timer
            // Tracks payment processing duration with labels for status (success, failed, pending)
            paymentProcessingDurationTimer = Timer.builder("payment_processing_duration_seconds")
                    .description("Time taken to process a payment transaction")
                    .tag("service", "forgepay-killbill-plugin")
                    .publishPercentiles(0.5, 0.95, 0.99)
                    .register(registry);

            // Initialize payment attempts counter
            // Tracks total payment attempts with labels for status and payment method
            paymentAttemptsCounter = Counter.builder("payment_attempts_total")
                    .description("Total number of payment attempts")
                    .tag("service", "forgepay-killbill-plugin")
                    .register(registry);

            // Initialize webhook events counter
            // Tracks webhook events processed with labels for event type
            webhookEventsProcessedCounter = Counter.builder("webhook_events_processed_total")
                    .description("Total number of webhook events processed")
                    .tag("service", "forgepay-killbill-plugin")
                    .register(registry);

            // Initialize webhook processing timer
            // Tracks webhook processing duration with labels for event type
            webhookProcessingDurationTimer = Timer.builder("webhook_processing_duration_seconds")
                    .description("Time taken to process a webhook event")
                    .tag("service", "forgepay-killbill-plugin")
                    .publishPercentiles(0.5, 0.95, 0.99)
                    .register(registry);

            logger.info("MetricsRegistry initialized successfully with Prometheus registry");
        } catch (Exception e) {
            logger.error("Failed to initialize MetricsRegistry", e);
            throw new RuntimeException("Failed to initialize Prometheus metrics", e);
        }
    }

    /**
     * Returns the Prometheus meter registry.
     * Throws IllegalStateException if not initialized.
     */
    public static MeterRegistry getMeterRegistry() {
        PrometheusMeterRegistry registry = registryHolder.get();
        if (registry == null) {
            throw new IllegalStateException("MetricsRegistry not initialized. Call initialize() first.");
        }
        return registry;
    }

    /**
     * Returns the Prometheus meter registry for metrics export.
     * Used by MetricsServlet to expose metrics in Prometheus text format.
     */
    public static PrometheusMeterRegistry getPrometheusRegistry() {
        PrometheusMeterRegistry registry = registryHolder.get();
        if (registry == null) {
            throw new IllegalStateException("MetricsRegistry not initialized. Call initialize() first.");
        }
        return registry;
    }

    /**
     * Records payment processing duration.
     * Usage:
     *   Timer.Sample sample = Timer.start(getMeterRegistry());
     *   try {
     *       // process payment
     *   } finally {
     *       recordPaymentDuration(sample, "success");
     *   }
     */
    public static void recordPaymentDuration(Timer.Sample sample, String status) {
        try {
            if (paymentProcessingDurationTimer != null && sample != null) {
                sample.stop(Timer.builder("payment_processing_duration_seconds")
                        .tag("status", status != null ? status : "unknown")
                        .tag("service", "forgepay-killbill-plugin")
                        .register(getMeterRegistry()));
            }
        } catch (Exception e) {
            logger.warn("Failed to record payment processing duration", e);
        }
    }

    /**
     * Increments the payment attempts counter.
     * @param status payment status (e.g., "success", "failed", "pending")
     * @param method payment method (e.g., "card", "bank_transfer", "crypto")
     */
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

    /**
     * Increments the webhook events processed counter.
     * @param eventType the type of webhook event (e.g., "payment.authorized", "payment.captured")
     */
    public static void incrementWebhookEventsProcessed(String eventType) {
        try {
            if (webhookEventsProcessedCounter != null) {
                Counter.builder("webhook_events_processed_total")
                        .tag("event_type", eventType != null ? eventType : "unknown")
                        .tag("service", "forgepay-killbill-plugin")
                        .register(getMeterRegistry())
                        .increment();
            }
        } catch (Exception e) {
            logger.warn("Failed to increment webhook events counter", e);
        }
    }

    /**
     * Records webhook processing duration.
     * Usage:
     *   Timer.Sample sample = Timer.start(getMeterRegistry());
     *   try {
     *       // process webhook
     *   } finally {
     *       recordWebhookDuration(sample, "payment.captured");
     *   }
     */
    public static void recordWebhookDuration(Timer.Sample sample, String eventType) {
        try {
            if (webhookProcessingDurationTimer != null && sample != null) {
                sample.stop(Timer.builder("webhook_processing_duration_seconds")
                        .tag("event_type", eventType != null ? eventType : "unknown")
                        .tag("service", "forgepay-killbill-plugin")
                        .register(getMeterRegistry()));
            }
        } catch (Exception e) {
            logger.warn("Failed to record webhook processing duration", e);
        }
    }

    /**
     * Returns Prometheus metrics in text format for export.
     * Used by MetricsServlet to expose metrics.
     */
    public static String getPrometheusMetricsText() {
        try {
            return getPrometheusRegistry().scrape();
        } catch (Exception e) {
            logger.error("Failed to scrape Prometheus metrics", e);
            return "";
        }
    }

    /**
     * Resets the registry (useful for testing).
     */
    public static synchronized void reset() {
        registryHolder.set(null);
        paymentProcessingDurationTimer = null;
        paymentAttemptsCounter = null;
        webhookEventsProcessedCounter = null;
        webhookProcessingDurationTimer = null;
        logger.info("MetricsRegistry reset");
    }
}
