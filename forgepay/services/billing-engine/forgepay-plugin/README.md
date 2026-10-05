# forgepay-hyperswitch — Kill Bill payment plugin

Charges Kill Bill payments through Hyperswitch. Built against the plugin API
that Kill Bill 0.24.10 ships (`killbill-api` 0.54.0,
`killbill-plugin-api-payment` 0.27.1) as an OSGi bundle; only Gson is embedded.

```
mvn package        # → target/forgepay-hyperswitch-plugin-0.2.0.jar, runs the tests
```

## How it works

- **Payment method.** The card stays in Hyperswitch's vault. The Kill Bill
  payment method's external key is `hyperswitch:<customer_id>:<payment_method_id>`.
  A payment method without one fails its payments with
  `NO_HYPERSWITCH_PAYMENT_METHOD`, without calling Hyperswitch.
- **Purchase / authorise.** `POST /payments` with `confirm`, `off_session`,
  `recurring_details: { type: payment_method_id }`, and capture method
  `automatic` (purchase) or `manual` (authorise).
- **Capture / void.** `POST /payments/{id}/capture` and `/cancel` on the
  authorisation.
- **Refund.** `POST /refunds` against the original purchase or authorisation.
- **Credit** (paying out with no original payment), search, hosted payment
  pages and notifications are not supported and say so.

## Idempotency and reconciliation

There is no plugin database. Each Kill Bill transaction maps to a fixed
Hyperswitch id: `kb_<transaction id>` for payments, `kbr_<transaction id>` for
refunds. A retried request collides with the first and is answered by reading
the existing one, so a retry never charges twice. Kill Bill's janitor calls
`getPaymentInfo`, which re-reads every transaction by those ids; a payment
Hyperswitch has never seen is reported as failed (nothing was charged).

Network errors and 5xx responses with no record at Hyperswitch are returned as
`UNDEFINED`, which Kill Bill leaves for the janitor rather than treating as
paid or failed.

## Configuration

`HYPERSWITCH_BASE_URL` and `HYPERSWITCH_API_KEY` in the Kill Bill process
environment. With no key the bundle does not register the plugin.
