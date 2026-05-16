package org.killbill.billing.payment.plugin.api;

import org.killbill.billing.catalog.api.Currency;
import org.killbill.billing.payment.api.PluginProperty;
import org.killbill.billing.util.callcontext.CallContext;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Kill Bill Payment Plugin API interface.
 * Mock interface for local development/testing when Kill Bill artifacts are unavailable.
 */
public interface PaymentPluginApi {

    PaymentTransactionInfoPlugin authorizePayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            BigDecimal amount,
            Currency currency,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    PaymentTransactionInfoPlugin capturePayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            BigDecimal amount,
            Currency currency,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    PaymentTransactionInfoPlugin refundPayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            BigDecimal refundAmount,
            Currency currency,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    PaymentTransactionInfoPlugin voidPayment(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    PaymentTransactionInfoPlugin getPaymentInfo(
            UUID kbAccountId,
            UUID kbPaymentId,
            UUID kbTransactionId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    HostedPaymentPageFormDescriptor buildFormDescriptor(
            UUID kbAccountId,
            Iterable<PluginProperty> customProperties,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    GatewayNotification processNotification(
            String notification,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    void addPaymentMethod(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            PaymentMethodPlugin paymentMethod,
            boolean setDefault,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    void deletePaymentMethod(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    PaymentMethodPlugin getPaymentMethodDetail(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    void setDefaultPaymentMethod(
            UUID kbAccountId,
            UUID kbPaymentMethodId,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    List<PaymentMethodPlugin> getPaymentMethods(
            UUID kbAccountId,
            boolean refreshFromGateway,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    void resetPaymentMethods(
            UUID kbAccountId,
            List<PaymentMethodPlugin> paymentMethods,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;

    List<PaymentTransactionInfoPlugin> searchPayments(
            String searchKey,
            Long offset,
            Long limit,
            Iterable<PluginProperty> properties,
            CallContext context) throws PaymentPluginApiException;
}
