# Stripe setup

Payments use hosted Stripe Checkout. The app never sees card data.

## Environment

| Var | Notes |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_...` locally and on Dev; `sk_live_...` only on the production service. A live key is refused when `NODE_ENV` is not `production`. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the endpoint that delivers to this environment (see below). Test and live differ, and so does the CLI's. |
| `BETTER_AUTH_URL` | Used to build the pay link and Checkout return URLs. Must be the public URL in production. |

## Webhook

- Endpoint: `POST /api/webhooks/stripe` (public route; authenticated only by signature).
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `checkout.session.expired`, `charge.refunded`.

### Local

```
stripe login
stripe listen --forward-to localhost:3100/api/webhooks/stripe \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,charge.refunded
```

Put the printed `whsec_...` in `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`.

### Production

Dashboard -> Developers -> Webhooks -> add `https://<render-domain>/api/webhooks/stripe` with the events above, then set that
endpoint's signing secret as `STRIPE_WEBHOOK_SECRET` on Render, alongside the live `STRIPE_SECRET_KEY`.

## Trying it locally

1. Send an invoice from the app (or `MAIL_DRIVER=log` and copy the "Online payment link" from the invoice page).
2. Open the link, pay with `4242 4242 4242 4242` (any future expiry/CVC).
3. With `stripe listen` running, the invoice flips to Paid. Refund from the invoice page, or from the Stripe dashboard.
   Bank (ACH) and other delayed methods settle via `async_payment_succeeded` and are enabled in the Stripe dashboard.
