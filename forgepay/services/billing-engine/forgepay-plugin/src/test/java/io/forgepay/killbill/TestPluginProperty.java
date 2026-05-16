package io.forgepay.killbill;

import org.killbill.billing.payment.api.PluginProperty;

/**
 * Test implementation of PluginProperty for unit tests.
 */
public class TestPluginProperty implements PluginProperty {

    private final String key;
    private final Object value;

    public TestPluginProperty(String key, Object value) {
        this.key = key;
        this.value = value;
    }

    @Override
    public String getKey() {
        return key;
    }

    @Override
    public Object getValue() {
        return value;
    }

    @Override
    public String toString() {
        return "TestPluginProperty{" +
                "key='" + key + '\'' +
                ", value=" + value +
                '}';
    }
}
