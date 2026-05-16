package org.killbill.billing.payment.plugin.api;

import org.joda.time.DateTime;

import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

/**
 * Payment transaction information returned by plugin.
 * Mock interface for local development/testing.
 */
public interface PaymentTransactionInfoPlugin {

    UUID getKbPaymentId();

    UUID getKbTransactionPaymentId();

    String getTransactionType();

    BigDecimal getAmount();

    BigDecimal getProcessedAmount();

    String getCurrency();

    boolean isSuccess();

    String getGatewayError();

    String getGatewayErrorCode();

    String getFirstPaymentReferenceId();

    String getSecondPaymentReferenceId();

    Map<String, String> getProperties();

    DateTime getCreatedDate();

    DateTime getEffectiveDate();
}
