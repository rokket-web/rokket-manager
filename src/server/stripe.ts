import Stripe from "stripe";

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Online payments are not configured yet.");
    this.name = "StripeNotConfiguredError";
  }
}

let cached: Stripe | undefined;
let override: Stripe | undefined;

/** Tests inject a fake. Pass undefined to restore the real client. */
export function setStripeForTests(s: Stripe | undefined) {
  override = s;
}

export function stripeConfigured(): boolean {
  return !!override || !!process.env.STRIPE_SECRET_KEY;
}

/** Configured Stripe client. A live key is refused outside production so dev/test can never move real money. */
export function getStripe(): Stripe {
  if (override) return override;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  if (key.startsWith("sk_live_") && process.env.NODE_ENV !== "production") {
    throw new Error("Refusing to use a live Stripe key outside production.");
  }
  cached ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return cached;
}

export class WebhookError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

/** Verify the signature against the RAW body. Throws WebhookError (400 bad signature, 503 not configured). */
export function verifyStripeWebhook(rawBody: string, signature: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new WebhookError("Webhook secret is not configured", 503);
  if (!signature) throw new WebhookError("Missing signature", 400);
  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) throw new WebhookError("Stripe is not configured", 503);
    throw new WebhookError("Invalid signature", 400);
  }
}

/** Absolute base URL of this app, no trailing slash. */
export function appBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
}

export function payUrl(publicToken: string): string {
  return `${appBaseUrl()}/pay/${publicToken}`;
}
