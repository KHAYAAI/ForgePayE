import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "get_integration_code",
    description:
      "Return copy-pasteable SDK code snippets for integrating ForgePay. Use in Integrate mode.",
    input_schema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "Programming language: typescript | python | go | ruby | php",
        },
        feature: {
          type: "string",
          description: "Feature to show: checkout | subscriptions | webhooks | stablecoins | crypto",
        },
      },
      required: ["language", "feature"],
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["integration"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    const language = input.language as string;
    const feature = input.feature as string;

    if (language === "typescript" && feature === "checkout") {
      return {
        language,
        feature,
        snippet: `import { ForgePay } from '@forgepay/sdk';

const fp = new ForgePay(process.env.FORGEPAY_API_KEY!);

const session = await fp.checkout.create({
  amount: 2999,
  currency: 'USD',
  successUrl: 'https://yoursite.com/success',
  cancelUrl:  'https://yoursite.com/cancel',
});

// Redirect customer to the hosted checkout page
console.log(session.url);
`,
      };
    }

    if (language === "typescript" && feature === "subscriptions") {
      return {
        language,
        feature,
        snippet: `import { ForgePay } from '@forgepay/sdk';

const fp = new ForgePay(process.env.FORGEPAY_API_KEY!);

// Create a subscription for an existing customer
const subscription = await fp.subscriptions.create({
  customerId: 'cust_xxx',
  planId:     'plan_pro_monthly',
  trialDays:  14,
});

console.log(subscription.id);   // sub_xxx
console.log(subscription.status); // 'trialing'
`,
      };
    }

    if (language === "typescript" && feature === "webhooks") {
      return {
        language,
        feature,
        snippet: `import { ForgePay } from '@forgepay/sdk';
import type { Request, Response } from 'express';

const fp = new ForgePay(process.env.FORGEPAY_API_KEY!);
const webhookSecret = process.env.FORGEPAY_WEBHOOK_SECRET!;

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['forgepay-signature'] as string;

  // Verify HMAC-SHA256 signature before processing
  const event = fp.webhooks.constructEvent(
    req.rawBody,
    signature,
    webhookSecret,
  );

  switch (event.type) {
    case 'payment.succeeded':
      console.log('Payment succeeded:', event.data.id);
      break;
    case 'subscription.cancelled':
      console.log('Subscription cancelled:', event.data.id);
      break;
    default:
      console.log('Unhandled event type:', event.type);
  }

  res.json({ received: true });
}
`,
      };
    }

    if (language === "python" && feature === "checkout") {
      return {
        language,
        feature,
        snippet: `import os
import forgepay

fp = forgepay.ForgePay(api_key=os.environ["FORGEPAY_API_KEY"])

session = fp.checkout.create(
    amount=2999,
    currency="USD",
    success_url="https://yoursite.com/success",
    cancel_url="https://yoursite.com/cancel",
)

# Redirect customer to the hosted checkout page
print(session.url)
`,
      };
    }

    // Fallback for all other language/feature combinations
    return {
      stub: true,
      message: `SDK snippet for ${feature} in ${language}`,
    };
  },
});
