# FORGE Billing Engine

Stock [Kill Bill](https://github.com/killbill/killbill) 0.24.10 (Apache 2.0) with
FORGE's catalog and one payment plugin, `forgepay-hyperswitch`, that charges
through Hyperswitch (the payment engine at this repo's root).

```
billing-engine (Kill Bill on Tomcat, port 8080 in the container)
  ├── config/killbill.properties         static settings (no secrets, no ${VAR})
  ├── config/catalog/forgepay-base-catalog.xml
  └── forgepay-plugin/                   OSGi bundle → Hyperswitch /payments, /refunds
```

## What has been verified

Run on 2026-10-05 against `killbill/killbill:0.24.10` with a local Postgres 16
and a fake Hyperswitch that speaks the real routes:

- the catalog passes Kill Bill's own validation (`POST /1.0/kb/catalog/xml/validate`)
  and uploads to a tenant with `scripts/upload-catalog.sh`;
- `payments-standard` starts with a $0 first month (checkout has already charged
  it) and bills $28 from month two; `payments-free` is $0;
- the plugin bundle resolves and registers in Kill Bill's OSGi framework;
- a purchase through Kill Bill becomes an off-session Hyperswitch payment
  against the saved card (`SUCCESS`); a decline is recorded as
  `PAYMENT_FAILURE` with the gateway code; a refund targets the original payment.

Not verified here: the Docker builder stage (this sandbox cannot reach Maven
Central from inside a container; the same `mvn package` was run on the host),
invoice-driven renewals over a real billing cycle, and anything against a real
Hyperswitch or card network.

## Configuration

Kill Bill does not expand `${VAR}` in `killbill.properties`. Environment-specific
values are environment variables, which the image applies on top of the file:

| Variable | Purpose |
|---|---|
| `KB_org_killbill_dao_url` / `_user` / `_password` | Kill Bill database |
| `KB_org_killbill_billing_osgi_dao_url` / `_user` / `_password` | Plugin framework database (same DB) |
| `KB_ADMIN_PASSWORD` | Kill Bill admin password |
| `HYPERSWITCH_BASE_URL` | Payment engine URL |
| `HYPERSWITCH_API_KEY` | Hyperswitch merchant secret key. Unset → plugin not registered |

Secrets come from Vault or AWS Secrets Manager.

The database needs Kill Bill's schema before first boot: the PostgreSQL bridge
(`org/killbill/billing/util/ddl-postgresql.sql` in `killbill-util-0.24.10.jar`,
run as a superuser) and then each module's `ddl.sql` (account, beatrix, catalog,
entitlement, invoice, payment, subscription, tenant, usage, util, and
`org/killbill/queue/ddl.sql` from `killbill-queue`). All of these ship inside
the image under `/var/lib/tomcat/webapps/ROOT/WEB-INF/lib/`.

## Catalog per tenant

Kill Bill runs multi-tenant, and in that mode it does **not** fall back to
`org.killbill.catalog.uri` for a tenant: until a catalog is uploaded, every
subscription call fails with "No existing versions in the VersionedCatalog".
After creating a tenant, and after every catalog change, run
`scripts/upload-catalog.sh` (it validates first). unified-router talks to
Kill Bill as that tenant (`KILLBILL_API_KEY` / `KILLBILL_API_SECRET`) and as a
Kill Bill user (`KILLBILL_USERNAME` / `KILLBILL_PASSWORD`); it needs both.

## Plans

| Plan | Price | Used by |
|---|---|---|
| `payments-free` | $0 | checkout, tier `free` in `forgepay/config/pricing.yaml` |
| `payments-standard` | $0 first month, then $28/month | checkout, tier `standard` |
| `forgepay-growth-monthly` / `-annual` | $5/month, $50/year, 14-day trial | SDK examples |
| `forgepay-ai-tokens-monthly` | $0.001 per token, in arrears | add-on |

`unified-router/__tests__/plans.test.ts` fails if checkout's tiers and these
plans disagree on names or prices.

## Payment methods

A Kill Bill payment method for this plugin carries the Hyperswitch references
in its external key: `hyperswitch:<customer_id>:<payment_method_id>`.
Checkout creates it when it provisions the account (see
`unified-router/src/routes/checkout.ts`). See `forgepay-plugin/README.md`.
