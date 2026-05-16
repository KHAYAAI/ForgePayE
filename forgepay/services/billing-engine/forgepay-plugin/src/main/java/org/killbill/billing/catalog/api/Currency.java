package org.killbill.billing.catalog.api;

/**
 * Currency enum.
 * Mock interface for local development/testing.
 */
public enum Currency {
    USD, EUR, GBP, CAD, AUD, JPY, CHF, INR, CNY, SGD, HKD, NZD;

    public String getName() {
        return name();
    }
}
