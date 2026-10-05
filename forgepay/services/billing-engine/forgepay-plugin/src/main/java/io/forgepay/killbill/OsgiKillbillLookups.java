package io.forgepay.killbill;

import org.killbill.billing.osgi.api.OSGIKillbill;
import org.killbill.billing.payment.api.Payment;
import org.killbill.billing.payment.api.PaymentMethod;
import org.killbill.billing.payment.api.PaymentTransaction;
import org.killbill.billing.util.callcontext.TenantContext;
import org.osgi.util.tracker.ServiceTracker;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/** KillbillLookups backed by the OSGIKillbill service Kill Bill registers for plugins. */
final class OsgiKillbillLookups implements KillbillLookups {

    private final ServiceTracker<OSGIKillbill, OSGIKillbill> tracker;

    OsgiKillbillLookups(final ServiceTracker<OSGIKillbill, OSGIKillbill> tracker) {
        this.tracker = tracker;
    }

    private OSGIKillbill killbill() {
        final OSGIKillbill kb = tracker.getService();
        if (kb == null) throw new IllegalStateException("OSGIKillbill service not available");
        return kb;
    }

    @Override
    public String paymentMethodExternalKey(final UUID kbPaymentMethodId, final TenantContext context) throws Exception {
        final PaymentMethod pm = killbill().getPaymentApi()
                .getPaymentMethodById(kbPaymentMethodId, false, false, Collections.emptyList(), context);
        return pm != null ? pm.getExternalKey() : null;
    }

    @Override
    public List<Txn> transactions(final UUID kbPaymentId, final TenantContext context) throws Exception {
        final Payment payment = killbill().getPaymentApi()
                .getPayment(kbPaymentId, false, false, Collections.emptyList(), context);
        final List<Txn> out = new ArrayList<>();
        if (payment != null) {
            for (final PaymentTransaction t : payment.getTransactions()) {
                out.add(new Txn(t.getId(), t.getTransactionType()));
            }
        }
        return out;
    }
}
