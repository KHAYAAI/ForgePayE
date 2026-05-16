package org.killbill.billing.payment.plugin.api;

/**
 * Exception thrown by payment plugin API operations.
 * Mock exception for local development/testing.
 */
public class PaymentPluginApiException extends Exception {

    private final String errorCode;

    public PaymentPluginApiException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public PaymentPluginApiException(String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public String getErrorCode() {
        return errorCode;
    }
}
