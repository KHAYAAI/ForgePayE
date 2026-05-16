package io.forgepay.killbill;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Configuration for the ForgePay Kill Bill payment plugin.
 * Loads environment variables and validates on startup.
 */
public class ForgepayPluginConfig {

    private static final Logger logger = LoggerFactory.getLogger(ForgepayPluginConfig.class);

    private final String hyperswitchUrl;
    private final String hyperswitchApiKey;
    private final String webhookSecret;
    private final int connectionTimeoutMs;
    private final int readTimeoutMs;
    private final int maxRetries;
    private final boolean amountInCents;

    public ForgepayPluginConfig() {
        this.hyperswitchUrl = getEnvironmentVariable("HYPERSWITCH_API_URL",
                "http://payment-engine:8080");
        this.hyperswitchApiKey = getEnvironmentVariable("HYPERSWITCH_API_KEY", null);
        this.webhookSecret = getEnvironmentVariable("KILLBILL_HYPERSWITCH_WEBHOOK_SECRET", null);
        this.connectionTimeoutMs = Integer.parseInt(getEnvironmentVariable(
                "HYPERSWITCH_CONNECTION_TIMEOUT", "10000"));
        this.readTimeoutMs = Integer.parseInt(getEnvironmentVariable(
                "HYPERSWITCH_READ_TIMEOUT", "30000"));
        this.maxRetries = Integer.parseInt(getEnvironmentVariable(
                "HYPERSWITCH_MAX_RETRIES", "2"));
        this.amountInCents = Boolean.parseBoolean(getEnvironmentVariable(
                "HYPERSWITCH_AMOUNT_IN_CENTS", "true"));

        validate();
    }

    /**
     * Validates configuration on startup.
     * Throws RuntimeException if critical values are missing.
     */
    private void validate() {
        if (hyperswitchUrl == null || hyperswitchUrl.trim().isEmpty()) {
            throw new RuntimeException(
                    "Missing required configuration: HYPERSWITCH_API_URL");
        }

        if (hyperswitchApiKey == null || hyperswitchApiKey.trim().isEmpty()) {
            throw new RuntimeException(
                    "Missing required configuration: HYPERSWITCH_API_KEY");
        }

        if (webhookSecret == null || webhookSecret.trim().isEmpty()) {
            logger.warn("KILLBILL_HYPERSWITCH_WEBHOOK_SECRET not set. Webhook signature verification disabled.");
        }

        if (connectionTimeoutMs <= 0) {
            throw new RuntimeException("HYPERSWITCH_CONNECTION_TIMEOUT must be > 0");
        }

        if (readTimeoutMs <= 0) {
            throw new RuntimeException("HYPERSWITCH_READ_TIMEOUT must be > 0");
        }

        logger.info("ForgePay Plugin Configuration validated: url={}, timeout={}ms",
                hyperswitchUrl, readTimeoutMs);
    }

    /**
     * Retrieves environment variable with optional default.
     */
    private String getEnvironmentVariable(String key, String defaultValue) {
        String value = System.getenv(key);
        return value != null ? value : defaultValue;
    }

    // Getters
    public String getHyperswitchUrl() {
        return hyperswitchUrl;
    }

    public String getHyperswitchApiKey() {
        return hyperswitchApiKey;
    }

    public String getWebhookSecret() {
        return webhookSecret;
    }

    public int getConnectionTimeoutMs() {
        return connectionTimeoutMs;
    }

    public int getReadTimeoutMs() {
        return readTimeoutMs;
    }

    public int getMaxRetries() {
        return maxRetries;
    }

    public boolean isAmountInCents() {
        return amountInCents;
    }
}
