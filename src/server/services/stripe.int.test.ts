import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { db } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import { setMailerForTests, type MailMessage } from "@/server/mail";
import { setStripeForTests, verifyStripeWebhook, WebhookError } from "@/server/stripe";
import * as invoices from "./invoices";
import * as billingEmail from "./billing-email";
import { processStripeEvent, refundPayment, startCheckout } from "./stripe-payments";

const P = `ZZTEST-${Math.random().toString(36).slice(2, 8)}`;
const SECRET = "whsec_test_secret";
let admin: ActorLike;
let clientId: string;

const stripe = new Stripe("sk_test_dummy"); // real class so webhook verification is the real code path
const create = vi.fn();
const retrieve = vi.fn();
const expire = vi.fn();
const refundsCreate = vi.fn();
const chargesRetrieve = vi.fn();
let sessionSeq = 0;

function signed(event: object): Stripe.Event {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return verifyStripeWebhook(payload, header);
}
let evSeq = 0;
const ev = (type: string, object: object) => ({ id: `evt_${P}_${++evSeq}`, object: "event", type, data: { object } });

async function sentInvoice(amount = "100") {
  const d = await invoices.createInvoice(admin, {
    clientId,
    lines: [{ description: "Work", quantity: "1", unitPrice: amount, taxable: false }],
  });
  return invoices.markInvoiceSent(admin, d.id);
}

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  admin = { id: a.id, role: "ADMIN" };
  clientId = (await db.client.create({ data: { name: `${P} Client`, billingEmail: "ap@example.test" } })).id;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  Object.assign(stripe.checkout.sessions, { create, retrieve, expire });
  Object.assign(stripe.refunds, { create: refundsCreate });
  Object.assign(stripe.charges, { retrieve: chargesRetrieve });
  setStripeForTests(stripe);
});

beforeEach(() => {
  for (const f of [create, retrieve, expire, refundsCreate, chargesRetrieve]) f.mockReset();
  create.mockImplementation(async () => ({ id: `cs_${P}_${++sessionSeq}`, url: `https://checkout.stripe.test/s${sessionSeq}`, status: "open" }));
});

afterAll(async () => {
  setStripeForTests(undefined);
  setMailerForTests(undefined);
  await db.payment.deleteMany({ where: { invoice: { clientId } } });
  await db.invoice.deleteMany({ where: { clientId } });
  await db.stripeEvent.deleteMany({ where: { id: { startsWith: `evt_${P}` } } });
  await db.activity.deleteMany({ where: { clientId } });
  await db.client.deleteMany({ where: { id: clientId } });
  await db.$disconnect();
});

describe("webhook signature", () => {
  it("rejects missing, wrong and tampered signatures", () => {
    const payload = JSON.stringify(ev("checkout.session.expired", { id: "cs_x" }));
    expect(() => verifyStripeWebhook(payload, null)).toThrow(WebhookError);
    expect(() => verifyStripeWebhook(payload, "t=1,v1=bad")).toThrow(WebhookError);
    const good = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(() => verifyStripeWebhook(payload + " ", good)).toThrow(WebhookError);
    expect(() => verifyStripeWebhook(payload, stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" }))).toThrow(
      WebhookError,
    );
  });
});

describe("checkout", () => {
  it("uses an unguessable token, bills the balance, and reuses an open session", async () => {
    const inv = await sentInvoice("100");
    expect(inv.publicToken.length).toBeGreaterThanOrEqual(32);
    const { url } = await startCheckout(inv.publicToken);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const args = create.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(10000);
    expect(args.customer_email).toBe("ap@example.test");
    expect(args.metadata.invoiceId).toBe(inv.id);
    const pending = await db.payment.findMany({ where: { invoiceId: inv.id } });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "PENDING", amountCents: 10000, method: "STRIPE" });

    retrieve.mockResolvedValue({ id: pending[0].stripeSessionId, status: "open", url });
    expect((await startCheckout(inv.publicToken)).url).toBe(url);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refuses drafts, paid invoices and malformed or unknown tokens", async () => {
    const d = await invoices.createInvoice(admin, { clientId, lines: [{ description: "x", quantity: "1", unitPrice: "5", taxable: false }] });
    await expect(startCheckout(d.publicToken)).rejects.toBeInstanceOf(ConflictError);
    await expect(startCheckout("short")).rejects.toBeInstanceOf(NotFoundError);
    await expect(startCheckout("x".repeat(40))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("webhook processing", () => {
  it("settles a paid session once, and ignores a replay", async () => {
    const inv = await sentInvoice("100");
    await startCheckout(inv.publicToken);
    const pay = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const e = signed(ev("checkout.session.completed", { id: pay.stripeSessionId, payment_status: "paid", amount_total: 10000, payment_intent: `pi_${P}_a` }));
    expect(await processStripeEvent(e)).toBe("processed");
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after).toMatchObject({ status: "PAID", paidCents: 10000 });
    expect(after.paidAt).not.toBeNull();
    expect(await processStripeEvent(e)).toBe("duplicate");
    expect((await db.payment.findMany({ where: { invoiceId: inv.id, status: "SUCCEEDED" } })).length).toBe(1);
  });

  it("waits for async payments, then settles or fails them", async () => {
    const inv = await sentInvoice("50");
    await startCheckout(inv.publicToken);
    const pay = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const sid = pay.stripeSessionId;
    await processStripeEvent(signed(ev("checkout.session.completed", { id: sid, payment_status: "unpaid", amount_total: 5000, payment_intent: `pi_${P}_b` })));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SENT");
    await processStripeEvent(signed(ev("checkout.session.async_payment_succeeded", { id: sid, payment_status: "paid", amount_total: 5000, payment_intent: `pi_${P}_b` })));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");

    const inv2 = await sentInvoice("20");
    await startCheckout(inv2.publicToken);
    const p2 = await db.payment.findFirstOrThrow({ where: { invoiceId: inv2.id } });
    await processStripeEvent(signed(ev("checkout.session.async_payment_failed", { id: p2.stripeSessionId })));
    expect((await db.payment.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe("FAILED");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv2.id } })).status).toBe("SENT");
  });

  it("ignores sessions it does not know and unrelated event types", async () => {
    expect(await processStripeEvent(signed(ev("checkout.session.completed", { id: "cs_unknown", payment_status: "paid", amount_total: 1 })))).toBe("processed");
    expect(await processStripeEvent(signed(ev("customer.created", { id: "cus_1" })))).toBe("ignored");
  });

  it("records refunds as cumulative deltas and reopens the balance", async () => {
    const inv = await sentInvoice("100");
    await startCheckout(inv.publicToken);
    const pay = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const pi = `pi_${P}_c`;
    await processStripeEvent(signed(ev("checkout.session.completed", { id: pay.stripeSessionId, payment_status: "paid", amount_total: 10000, payment_intent: pi })));
    const charge = (refunded: number) => ({ id: `ch_${P}`, payment_intent: pi, amount_refunded: refunded });

    await processStripeEvent(signed(ev("charge.refunded", charge(3000))));
    let cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur).toMatchObject({ status: "PARTIALLY_PAID", paidCents: 7000 });

    await processStripeEvent(signed(ev("charge.refunded", charge(3000)))); // new event id, same cumulative: no change
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paidCents).toBe(7000);

    await processStripeEvent(signed(ev("charge.refunded", charge(10000))));
    cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur).toMatchObject({ status: "SENT", paidCents: 0 });
    expect(cur.paidAt).toBeNull();
    const rows = await db.payment.findMany({ where: { invoiceId: inv.id, reference: `refund:ch_${P}` } });
    expect(rows.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([-7000, -3000]);
  });

  it("rolls the event back when processing fails, so Stripe can retry", async () => {
    // Two sessions claiming the same PaymentIntent: the second update violates the unique index mid-transaction.
    const a = await sentInvoice("10");
    const b = await sentInvoice("10");
    await startCheckout(a.publicToken);
    await startCheckout(b.publicToken);
    const pa = await db.payment.findFirstOrThrow({ where: { invoiceId: a.id } });
    const pb = await db.payment.findFirstOrThrow({ where: { invoiceId: b.id } });
    const pi = `pi_${P}_dup`;
    await processStripeEvent(signed(ev("checkout.session.completed", { id: pa.stripeSessionId, payment_status: "paid", amount_total: 1000, payment_intent: pi })));
    const bad = signed(ev("checkout.session.completed", { id: pb.stripeSessionId, payment_status: "paid", amount_total: 1000, payment_intent: pi }));
    await expect(processStripeEvent(bad)).rejects.toThrow();
    expect(await db.stripeEvent.findUnique({ where: { id: bad.id } })).toBeNull(); // not recorded, so a retry is processed
    expect((await db.payment.findUniqueOrThrow({ where: { id: pb.id } })).status).toBe("PENDING");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("SENT");
  });
});

describe("admin refunds", () => {
  it("refunds via Stripe, records it once, and surfaces Stripe's validation errors", async () => {
    const inv = await sentInvoice("100");
    await startCheckout(inv.publicToken);
    const pay = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const pi = `pi_${P}_d`;
    await processStripeEvent(signed(ev("checkout.session.completed", { id: pay.stripeSessionId, payment_status: "paid", amount_total: 10000, payment_intent: pi })));
    const paid = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id, status: "SUCCEEDED" } });

    refundsCreate.mockResolvedValue({ id: "re_1", charge: `ch_${P}_d` });
    chargesRetrieve.mockResolvedValue({ id: `ch_${P}_d`, payment_intent: pi, amount_refunded: 2500 });
    await refundPayment(admin, paid.id, 2500);
    expect(refundsCreate.mock.calls[0][0]).toMatchObject({ payment_intent: pi, amount: 2500 });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paidCents).toBe(7500);
    // the webhook for the same refund arrives afterwards: no double count
    await processStripeEvent(signed(ev("charge.refunded", { id: `ch_${P}_d`, payment_intent: pi, amount_refunded: 2500 })));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paidCents).toBe(7500);

    await expect(refundPayment(admin, paid.id, 10001)).rejects.toBeInstanceOf(ConflictError);
    const err = Object.assign(new Error("Charge already refunded"), { name: "StripeInvalidRequestError" });
    refundsCreate.mockRejectedValueOnce(err);
    await expect(refundPayment(admin, paid.id, 100)).rejects.toThrow("Charge already refunded");
    await expect(refundPayment({ id: "s", role: "STAFF" }, paid.id, 100)).rejects.toThrow();
  });
});

describe("void with an open payment link", () => {
  it("expires the session, fails the pending row, then voids", async () => {
    const inv = await sentInvoice("30");
    await startCheckout(inv.publicToken);
    const pay = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expire.mockResolvedValue({});
    expect((await invoices.voidInvoice(admin, inv.id)).status).toBe("VOID");
    expect(expire).toHaveBeenCalledWith(pay.stripeSessionId);
    expect((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("FAILED");
  });

  it("refuses to void when the session was already paid", async () => {
    const inv = await sentInvoice("30");
    await startCheckout(inv.publicToken);
    expire.mockRejectedValue(new Error("already complete"));
    retrieve.mockResolvedValue({ status: "complete" });
    await expect(invoices.voidInvoice(admin, inv.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SENT");
  });
});

describe("invoice email", () => {
  it("includes the online payment link", async () => {
    const sent: MailMessage[] = [];
    setMailerForTests({ send: async (m) => void sent.push(m) });
    const d = await invoices.createInvoice(admin, { clientId, lines: [{ description: "x", quantity: "1", unitPrice: "40", taxable: false }] });
    expect((await billingEmail.sendInvoice(admin, d.id)).emailed).toBe(true);
    const token = (await db.invoice.findUniqueOrThrow({ where: { id: d.id } })).publicToken;
    expect(sent[0].text).toContain(`/pay/${token}`);
    expect(sent[0].html).toContain(`/pay/${token}`);
  });
});
