package io.forgepay.killbill;

import org.joda.time.DateTime;
import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.PluginProperty;
import org.killbill.billing.payment.api.TransactionType;
import org.killbill.billing.payment.plugin.api.PaymentPluginStatus;
import org.killbill.billing.payment.plugin.api.PaymentTransactionInfoPlugin;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** Immutable PaymentTransactionInfoPlugin returned to Kill Bill. */
final class TxnInfo implements PaymentTransactionInfoPlugin {

    private final UUID kbPaymentId;
    private final UUID kbTransactionId;
    private final TransactionType type;
    private final BigDecimal amount;
    private final Currency currency;
    private final PaymentPluginStatus status;
    private final String gatewayError;
    private final String gatewayErrorCode;
    private final String firstReference;
    private final String secondReference;
    private final DateTime createdDate;
    private final List<PluginProperty> properties;

    TxnInfo(final UUID kbPaymentId, final UUID kbTransactionId, final TransactionType type,
            final BigDecimal amount, final Currency currency, final PaymentPluginStatus status,
            final String gatewayError, final String gatewayErrorCode,
            final String firstReference, final String secondReference,
            final DateTime createdDate, final List<PluginProperty> properties) {
        this.kbPaymentId = kbPaymentId;
        this.kbTransactionId = kbTransactionId;
        this.type = type;
        this.amount = amount;
        this.currency = currency;
        this.status = status;
        this.gatewayError = gatewayError;
        this.gatewayErrorCode = gatewayErrorCode;
        this.firstReference = firstReference;
        this.secondReference = secondReference;
        this.createdDate = createdDate;
        this.properties = properties;
    }

    @Override public UUID getKbPaymentId() { return kbPaymentId; }
    @Override public UUID getKbTransactionPaymentId() { return kbTransactionId; }
    @Override public TransactionType getTransactionType() { return type; }
    @Override public BigDecimal getAmount() { return amount; }
    @Override public Currency getCurrency() { return currency; }
    @Override public DateTime getCreatedDate() { return createdDate; }
    @Override public DateTime getEffectiveDate() { return createdDate; }
    @Override public PaymentPluginStatus getStatus() { return status; }
    @Override public String getGatewayError() { return gatewayError; }
    @Override public String getGatewayErrorCode() { return gatewayErrorCode; }
    @Override public String getFirstPaymentReferenceId() { return firstReference; }
    @Override public String getSecondPaymentReferenceId() { return secondReference; }
    @Override public List<PluginProperty> getProperties() { return properties; }

    @Override
    public String toString() {
        return "TxnInfo{" + type + " " + status + " " + amount + " " + currency
                + " ref=" + firstReference + " err=" + gatewayErrorCode + "}";
    }
}
