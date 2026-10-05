package io.forgepay.killbill;

import org.killbill.billing.osgi.api.OSGIKillbill;
import org.killbill.billing.osgi.api.OSGIPluginProperties;
import org.killbill.billing.payment.plugin.api.PaymentPluginApi;
import org.osgi.framework.BundleActivator;
import org.osgi.framework.BundleContext;
import org.osgi.framework.ServiceRegistration;
import org.osgi.util.tracker.ServiceTracker;

import java.util.Hashtable;
import java.util.logging.Logger;

/**
 * Registers HyperswitchPaymentPluginApi with Kill Bill under the plugin name
 * `forgepay-hyperswitch` (the value of org.killbill.payment.plugin.name and
 * of `pluginName` on payment methods).
 *
 * Configuration comes from the Kill Bill process environment:
 *   HYPERSWITCH_BASE_URL  e.g. http://payment-engine:8080
 *   HYPERSWITCH_API_KEY   the merchant's secret key (from Vault / Secrets Manager)
 *
 * With no API key the plugin is not registered at all, so payments fail
 * visibly ("plugin not found") instead of being sent unauthenticated.
 */
public class ForgepayActivator implements BundleActivator {

    private static final Logger LOG = Logger.getLogger(ForgepayActivator.class.getName());

    private ServiceTracker<OSGIKillbill, OSGIKillbill> killbillTracker;
    private ServiceRegistration<PaymentPluginApi> registration;

    @Override
    public void start(final BundleContext context) {
        final String baseUrl = env("HYPERSWITCH_BASE_URL", "http://payment-engine:8080");
        final String apiKey = env("HYPERSWITCH_API_KEY", "");
        if (apiKey.isEmpty()) {
            LOG.severe("[" + HyperswitchPaymentPluginApi.PLUGIN_NAME + "] HYPERSWITCH_API_KEY is not set; plugin NOT registered");
            return;
        }

        killbillTracker = new ServiceTracker<>(context, OSGIKillbill.class, null);
        killbillTracker.open();

        final HyperswitchPaymentPluginApi api = new HyperswitchPaymentPluginApi(
                new HyperswitchClient(baseUrl, apiKey), new OsgiKillbillLookups(killbillTracker));

        final Hashtable<String, Object> props = new Hashtable<>();
        props.put(OSGIPluginProperties.PLUGIN_NAME_PROP, HyperswitchPaymentPluginApi.PLUGIN_NAME);
        registration = context.registerService(PaymentPluginApi.class, api, props);
        LOG.info("[" + HyperswitchPaymentPluginApi.PLUGIN_NAME + "] registered; Hyperswitch at " + baseUrl);
    }

    @Override
    public void stop(final BundleContext context) {
        if (registration != null) {
            registration.unregister();
            registration = null;
        }
        if (killbillTracker != null) {
            killbillTracker.close();
            killbillTracker = null;
        }
    }

    private static String env(final String key, final String fallback) {
        final String v = System.getenv(key);
        return v == null || v.isBlank() ? fallback : v.trim();
    }
}
