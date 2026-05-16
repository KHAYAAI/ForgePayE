package io.forgepay.killbill;

import org.killbill.billing.payment.plugin.api.PaymentPluginApiException;

/**
 * Base exception for ForgePay plugin payment errors.
 * Extends Kill Bill's PaymentPluginApiException for proper error handling.
 */
public class ForgepayPaymentException extends PaymentPluginApiException {

    private final String errorCode;
    private final String errorDetails;

    public ForgepayPaymentException(String message) {
        super(null, message);
        this.errorCode = "INTERNAL_ERROR";
        this.errorDetails = message;
    }

    public ForgepayPaymentException(String message, Throwable cause) {
        super(null, message, cause);
        this.errorCode = "INTERNAL_ERROR";
        this.errorDetails = message;
    }

    public ForgepayPaymentException(String errorCode, String message) {
        super(null, message);
        this.errorCode = errorCode;
        this.errorDetails = message;
    }

    public ForgepayPaymentException(String errorCode, String message, Throwable cause) {
        super(null, message, cause);
        this.errorCode = errorCode;
        this.errorDetails = message;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public String getErrorDetails() {
        return errorDetails;
    }
}
