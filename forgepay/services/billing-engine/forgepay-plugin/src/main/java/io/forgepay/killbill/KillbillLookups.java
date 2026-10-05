package io.forgepay.killbill;

import org.killbill.billing.payment.api.TransactionType;
import org.killbill.billing.util.callcontext.TenantContext;

import java.util.List;
import java.util.UUID;

/**
 * What the plugin needs to read back from Kill Bill itself. Kept behind an
 * interface so the plugin is testable without a running Kill Bill; the real
 * implementation (OsgiKillbillLookups) goes through the OSGIKillbill service.
 */
public interface KillbillLookups {

    /** A Kill Bill transaction on a payment: its id, type and external key. */
    final class Txn {
        public final UUID id;
        public final TransactionType type;

        public Txn(final UUID id, final TransactionType type) {
            this.id = id;
            this.type = type;
        }
    }

    /** The external key of a Kill Bill payment method, or null if it has none. */
    String paymentMethodExternalKey(UUID kbPaymentMethodId, TenantContext context) throws Exception;

    /** Every transaction Kill Bill holds for a payment, oldest first. */
    List<Txn> transactions(UUID kbPaymentId, TenantContext context) throws Exception;
}
