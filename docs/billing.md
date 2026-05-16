# FlowPath Billing

FlowPath uses Stripe Checkout for Core subscriptions, Stripe Billing for recurring
subscription state, and Stripe Customer Portal for plan management.

## Required Environment Variables

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CORE_MONTHLY_PRICE_ID=
APP_URL=http://localhost:3000
STRIPE_SUCCESS_URL=http://localhost:3000/billing?checkout=success
STRIPE_CANCEL_URL=http://localhost:3000/billing?checkout=cancelled
INTERNAL_UNLIMITED_EMAILS=email1@example.com,email2@example.com
```

Use Stripe test-mode keys locally. Do not commit `.env.local`.

## Stripe Product And Price

Create one product and recurring price in Stripe:

- Product: `FlowPath Core`
- Price: `$12/month`
- Copy the recurring price id, for example `price_...`, into
  `STRIPE_CORE_MONTHLY_PRICE_ID`.

## Local Checkout Test

1. Add the Stripe env vars to `.env.local`.
2. Run `npm run db:init` so billing tables and user fields exist.
3. Run `npm run dev`.
4. Visit `/billing` and click `Upgrade to Core`.
5. Use Stripe test card details in Checkout.

## Local Webhook Test

Install and sign in to the Stripe CLI, then forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`, restart the dev
server, then complete a test Checkout session. The webhook should update the
local `users` row to `plan_tier='core'` when the subscription is active.

Useful test events:

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.payment_failed
```

Checkout-created subscriptions are the best end-to-end test because they include
the FlowPath user id metadata.

## Internal Unlimited Users

Internal test users can be assigned in either place:

- Env allowlist: add lowercase emails to `INTERNAL_UNLIMITED_EMAILS`.
- Database flag: set `users.internal_unlimited=1` and
  `users.plan_tier='internal_unlimited'`.

Stripe webhooks never downgrade internal unlimited users. They may still update
Stripe ids and billing status for visibility, but the effective tier remains
`internal_unlimited`.

## Usage Limits

Monthly limits reset by calendar month using `APP_TIMEZONE`.

- Free: 1 Next Move plan, 3 Today check-ins, 5 lightweight assists.
- Core: 20 Next Move plans, 31 Today check-ins, 50 lightweight assists.
- Internal unlimited: no quota cap, but usage rows are still logged.

Server routes enforce quota before OpenAI calls. Free users do not receive
OpenAI web-search tools.
