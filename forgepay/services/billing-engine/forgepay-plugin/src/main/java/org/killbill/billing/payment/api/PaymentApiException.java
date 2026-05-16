package org.killbill.billing.payment.api;

/**
 * Payment API exception.
 * Mock interface for local development/testing.
 */
public class PaymentApiException extends Exception {
    public PaymentApiException(String message) {
        super(message);
    }
}
