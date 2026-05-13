// Importing these modules causes them to call registry.register() at load time.
import "./core/analytics";
import "./core/payments";
import "./core/customers";
import "./core/subscriptions";
import "./core/integration";
import "./core/crypto";
import "./core/webhooks";
import "./memory/recall";
import "./memory/store";
import "./delegation/delegate";
import "./billing/invoices";
import "./billing/credits";
