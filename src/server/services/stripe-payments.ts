import type Stripe from "stripe";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";
import { db } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";
import { balanceCents } from "@/lib/billing";
import { formatCents } from "@/lib/money";
import { appBaseUrl, getStripe } from "@/server/stripe";
import { logClientActivity, resolveRecipient, type Tx } from "./billing-core";
import { recomputeInvoicePayments } from "./payments";

const REUSE_WINDOW_MS = 20 * 60 * 60 * 1000; // Checkout sessions live 24h; reuse only comfortably-fresh ones.

// ---------- paying (public, token-authorised) ----------

type PayableInvoice = {
  id: string;
  number: string | null;
  currency: string;
  status: string;
  totalCents: number;
  paidCents: number;
  clientId: string;
  client: { name: string };
};

/**
 * Create or reuse a Stripe-hosted Checkout session for the invoice's current balance. The CALLER must already have
 * authorised access to this invoice (public token or owning portal client).
 */
export async function checkoutForInvoice(inv: PayableInvoice, urls: { success: string; cancel: string }): Promise<{ url: string }> {
  const balance = balanceCents(inv);
  if ((inv.status !== "SENT" && inv.status !== "PARTIALLY_PAID") || balance <= 0 || !inv.number) {
    throw new ConflictError("This invoice cannot be paid online.");
  }
  if (inv.currency !== "USD") throw new ConflictError("This invoice cannot be paid online.");
  const stripe = getStripe();

  const pending = await db.payment.findFirst({
    where: {
      invoiceId: inv.id,
      method: "STRIPE",
      status: "PENDING",
      amountCents: balance,
      stripeSessionId: { not: null },
      createdAt: { gt: new Date(Date.now() - REUSE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (pending?.stripeSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(pending.stripeSessionId);
    if (existing.status === "open" && existing.url) return { url: existing.url };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: inv.id,
    customer_email: (await resolveRecipient(inv.clientId)) ?? undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: balance,
          product_data: { name: `Invoice ${inv.number}`, description: inv.client.name },
        },
      },
    ],
    metadata: { invoiceId: inv.id },
    payment_intent_data: { metadata: { invoiceId: inv.id }, description: `Invoice ${inv.number}` },
    success_url: urls.success,
    cancel_url: urls.cancel,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  await db.payment.create({
    data: { invoiceId: inv.id, method: "STRIPE", status: "PENDING", amountCents: balance, currency: inv.currency, stripeSessionId: session.id },
  });
  return { url: session.url };
}

/** Public pay link: the unguessable token authorises paying THIS invoice. */
export async function startCheckout(token: string): Promise<{ url: string }> {
  if (!/^[\w-]{16,128}$/.test(token)) throw new NotFoundError();
  const inv = await db.invoice.findUnique({ where: { publicToken: token }, include: { client: { select: { name: true } } } });
  if (!inv) throw new NotFoundError();
  const base = appBaseUrl();
  return checkoutForInvoice(inv, {
    success: `${base}/pay/${token}/done?result=success`,
    cancel: `${base}/pay/${token}/done?result=cancelled`,
  });
}

/** Status shown on the public return page. Reveals only the number, amount and state. */
export async function publicInvoiceStatus(token: string) {
  if (!/^[\w-]{16,128}$/.test(token)) return null;
  const inv = await db.invoice.findUnique({
    where: { publicToken: token },
    select: { number: true, status: true, totalCents: true, paidCents: true, currency: true },
  });
  return inv?.number ? inv : null;
}

/** Expire open Checkout sessions so a voided invoice cannot be paid. Throws ConflictError if one was already paid. */
export async function cancelPendingCheckouts(invoiceId: string): Promise<void> {
  const pending = await db.payment.findMany({
    where: { invoiceId, method: "STRIPE", status: "PENDING", stripeSessionId: { not: null } },
    select: { id: true, stripeSessionId: true },
  });
  if (pending.length === 0) return;
  const stripe = getStripe();
  for (const p of pending) {
    try {
      await stripe.checkout.sessions.expire(p.stripeSessionId!);
    } catch {
      const s = await stripe.checkout.sessions.retrieve(p.stripeSessionId!);
      if (s.status === "complete") throw new ConflictError("A payment is being processed for this invoice. Try again shortly.");
      if (s.status !== "expired") throw new ConflictError("Could not cancel the open payment link. Please try again.");
    }
    await db.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED" } });
  }
}

// ---------- webhook processing ----------

async function settleSession(tx: Tx, session: Stripe.Checkout.Session) {
  const payment = await tx.payment.findUnique({ where: { stripeSessionId: session.id }, include: { invoice: { select: { number: true, clientId: true } } } });
  if (!payment || payment.status === "SUCCEEDED") return;
  const paid = session.amount_total ?? payment.amountCents;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  await tx.payment.update({
    where: { id: payment.id },
    data: { status: "SUCCEEDED", amountCents: paid, paidAt: new Date(), stripePaymentIntentId: pi },
  });
  const inv = await recomputeInvoicePayments(tx, payment.invoiceId);
  await logClientActivity(tx, payment.invoice.clientId, null, "invoice.payment", `Card payment of ${formatCents(paid, payment.currency)} received on ${payment.invoice.number}`);
  await audit(
    {
      action: "payment.stripe",
      entity: "Invoice",
      entityId: payment.invoiceId,
      meta: {
        paymentId: payment.id,
        amountCents: paid,
        status: inv.status,
        ...(paid !== payment.amountCents ? { amountMismatch: { expected: payment.amountCents } } : {}),
        ...(inv.paidCents > inv.totalCents ? { overpaidCents: inv.paidCents - inv.totalCents } : {}),
      },
    },
    tx,
  );
}

/** Make refund rows match the charge's cumulative refunded amount. Idempotent: only the delta is recorded. */
async function applyChargeRefunds(tx: Tx, charge: Pick<Stripe.Charge, "id" | "payment_intent" | "amount_refunded">) {
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
  if (!pi) return;
  const payment = await tx.payment.findUnique({ where: { stripePaymentIntentId: pi }, include: { invoice: { select: { number: true, clientId: true } } } });
  if (!payment) return;
  const ref = `refund:${charge.id}`;
  const agg = await tx.payment.aggregate({ where: { invoiceId: payment.invoiceId, reference: ref }, _sum: { amountCents: true } });
  const delta = charge.amount_refunded - -(agg._sum.amountCents ?? 0);
  if (delta <= 0) return;
  await tx.payment.create({
    data: { invoiceId: payment.invoiceId, method: "STRIPE", status: "SUCCEEDED", amountCents: -delta, currency: payment.currency, reference: ref, paidAt: new Date() },
  });
  const inv = await recomputeInvoicePayments(tx, payment.invoiceId);
  await logClientActivity(tx, payment.invoice.clientId, null, "invoice.refund", `Refund of ${formatCents(delta, payment.currency)} on ${payment.invoice.number}`);
  await audit({ action: "payment.refund", entity: "Invoice", entityId: payment.invoiceId, meta: { amountCents: delta, chargeId: charge.id, status: inv.status } }, tx);
}

export type EventOutcome = "processed" | "duplicate" | "ignored";

/**
 * Apply one verified Stripe event. The event id is recorded in the same transaction as its effects, so a failure
 * rolls both back (Stripe retries) and a repeat delivery is a no-op.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<EventOutcome> {
  return db.$transaction(async (tx) => {
    const fresh = await tx.stripeEvent.createMany({ data: [{ id: event.id, type: event.type }], skipDuplicates: true });
    if (fresh.count === 0) return "duplicate";
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (event.data.object.payment_status === "paid") await settleSession(tx, event.data.object);
        return "processed";
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await tx.payment.updateMany({ where: { stripeSessionId: event.data.object.id, status: "PENDING" }, data: { status: "FAILED" } });
        return "processed";
      case "charge.refunded":
        await applyChargeRefunds(tx, event.data.object);
        return "processed";
      default:
        return "ignored";
    }
  });
}

// ---------- admin refunds ----------

export async function refundPayment(actor: ActorLike, paymentId: string, amountCents: number) {
  assertBilling(actor, "billing:write");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new ConflictError("Enter a refund amount greater than zero.");
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError("Payment not found.");
  if (payment.method !== "STRIPE" || payment.status !== "SUCCEEDED" || payment.amountCents <= 0 || !payment.stripePaymentIntentId) {
    throw new ConflictError("Only successful card payments can be refunded here.");
  }
  if (amountCents > payment.amountCents) throw new ConflictError("That is more than the payment amount.");
  const stripe = getStripe();
  const prior = await db.payment.count({ where: { invoiceId: payment.invoiceId, reference: { startsWith: "refund:" } } });
  let chargeId: string;
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: payment.stripePaymentIntentId, amount: amountCents, metadata: { invoiceId: payment.invoiceId, paymentId } },
      // Same payment + amount + refund history => same key, so a double-submit cannot refund twice.
      { idempotencyKey: `refund-${paymentId}-${amountCents}-${prior}` },
    );
    if (!refund.charge) throw new Error("Refund has no charge");
    chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge.id;
  } catch (e) {
    if (e instanceof Error && e.name.startsWith("StripeInvalidRequest")) throw new ConflictError(e.message);
    throw e;
  }
  const charge = await stripe.charges.retrieve(chargeId);
  await db.$transaction(async (tx) => {
    await applyChargeRefunds(tx, charge);
    await audit({ actorId: actor.id, action: "payment.refund.request", entity: "Payment", entityId: paymentId, meta: { amountCents } }, tx);
  });
}

