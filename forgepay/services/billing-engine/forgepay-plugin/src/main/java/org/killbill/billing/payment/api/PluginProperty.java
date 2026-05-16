package org.killbill.billing.payment.api;

/**
 * Plugin property interface.
 * Mock interface for local development/testing.
 */
public interface PluginProperty {
    String getKey();
    Object getValue();
}
