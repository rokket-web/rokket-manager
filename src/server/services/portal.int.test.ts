import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import { setMailerForTests, type MailMessage } from "@/server/mail";
import { setStripeForTests, StripeNotConfiguredError } from "@/server/stripe";
import * as invoices from "./invoices";
import * as quotes from "./quotes";
import * as payments from "./payments";
import * as portal from "./portal";

const P = `ZZTEST-${Math.random().toString(36).slice(2, 8)}`;
let admin: ActorLike;
let staff: ActorLike;
let A: ActorLike; // portal user of client A
let B: ActorLike; // portal user of client B
let clientA: string;
let clientB: string;
const sent: MailMessage[] = [];
const stripe = new Stripe("sk_test_dummy");
const create = vi.fn();
const retrieve = vi.fn();

const line = (description: string, unitPrice = "100") => ({ description, quantity: "1", unitPrice, taxable: false });
async function sentInvoice(clientId: string, price = "100") {
  const d = await invoices.createInvoice(admin, { clientId, lines: [line("Work", price)] });
  return invoices.markInvoiceSent(admin, d.id);
}
async function sentQuote(clientId: string) {
  const d = await quotes.createQuote(admin, { clientId, title: "Site", lines: [line("Build", "500")] });
  return quotes.markQuoteSent(admin, d.id);
}

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  const s = await db.user.findUniqueOrThrow({ where: { email: "staff@rokket.test" } });
  admin = { id: a.id, role: "ADMIN" };
  staff = { id: s.id, role: "STAFF" };
  clientA = (await db.client.create({ data: { name: `${P} A`, billingEmail: "a@example.test" } })).id;
  clientB = (await db.client.create({ data: { name: `${P} B` } })).id;
  const ua = await db.user.create({ data: { name: "Pat A", email: `${P.toLowerCase()}-a@c.test`, role: "CLIENT", clientId: clientA } });
  const ub = await db.user.create({ data: { name: "Bo B", email: `${P.toLowerCase()}-b@c.test`, role: "CLIENT", clientId: clientB } });
  A = { id: ua.id, role: "CLIENT", clientId: clientA };
  B = { id: ub.id, role: "CLIENT", clientId: clientB };
  Object.assign(stripe.checkout.sessions, { create, retrieve });
});
beforeEach(() => {
  sent.length = 0;
  setMailerForTests({ send: async (m) => void sent.push(m) });
  create.mockReset();
  retrieve.mockReset();
  create.mockImplementation(async () => ({ id: `cs_${P}_${Math.random()}`, url: "https://checkout.stripe.test/x", status: "open" }));
  setStripeForTests(stripe);
});
afterAll(async () => {
  setStripeForTests(undefined);
  setMailerForTests(undefined);
  await db.payment.deleteMany({ where: { invoice: { clientId: { in: [clientA, clientB] } } } });
  await db.invoice.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  await db.quote.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: [A.id, B.id] } } });
  await db.activity.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  await db.user.deleteMany({ where: { id: { in: [A.id, B.id] } } });
  await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  await db.$disconnect();
});

describe("portal access control", () => {
  it("staff, admin and unlinked client users are forbidden everywhere", async () => {
    const unlinked: ActorLike = { id: "u", role: "CLIENT", clientId: null };
    for (const who of [staff, admin, unlinked]) {
      await expect(portal.listPortalInvoices(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(portal.listPortalQuotes(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(portal.getPortalSummary(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(portal.getPortalInvoice(who, "x")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(portal.respondToPortalQuote(who, "x", "ACCEPTED")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(portal.startPortalCheckout(who, "x")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(portal.renderPortalInvoicePdf(who, "x")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("a client only ever sees their own documents; another client's id is a plain not-found", async () => {
    const ia = await sentInvoice(clientA);
    const ib = await sentInvoice(clientB);
    const qa = await sentQuote(clientA);
    const qb = await sentQuote(clientB);
    expect((await portal.listPortalInvoices(A)).map((i) => i.id)).toEqual([ia.id]);
    expect((await portal.listPortalQuotes(A)).map((q) => q.id)).toEqual([qa.id]);
    await expect(portal.getPortalInvoice(A, ib.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.getPortalQuote(A, qb.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.renderPortalInvoicePdf(A, ib.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.renderPortalQuotePdf(A, qb.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.startPortalCheckout(A, ib.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.respondToPortalQuote(A, qb.id, "ACCEPTED")).rejects.toBeInstanceOf(NotFoundError);
    expect(create).not.toHaveBeenCalled();
    expect((await db.quote.findUniqueOrThrow({ where: { id: qb.id } })).status).toBe("SENT");
  });

  it("hides drafts and voided invoices, even by direct id", async () => {
    const draft = await invoices.createInvoice(admin, { clientId: clientA, lines: [line("Draft")] });
    const voided = await sentInvoice(clientA, "7");
    await invoices.voidInvoice(admin, voided.id);
    const dq = await quotes.createQuote(admin, { clientId: clientA, lines: [line("Draft quote")] });
    const ids = (await portal.listPortalInvoices(A)).map((i) => i.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(voided.id);
    await expect(portal.getPortalInvoice(A, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.getPortalInvoice(A, voided.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.getPortalQuote(A, dq.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.respondToPortalQuote(A, dq.id, "ACCEPTED")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not leak internal fields", async () => {
    const inv = await sentInvoice(clientA, "20");
    await payments.recordManualPayment(admin, inv.id, { amount: "5", reference: "INTERNAL check 123" });
    const view = await portal.getPortalInvoice(A, inv.id);
    const json = JSON.stringify(view);
    expect(json).not.toContain("publicToken");
    expect(json).not.toContain("INTERNAL check 123");
    expect(json).not.toMatch(/stripe/i);
    expect(view.payments).toHaveLength(1);
    expect(view.payments[0]).toMatchObject({ amountCents: 500, refund: false });
    expect(view.paidCents).toBe(500);
  });
});

describe("portal summary and documents", () => {
  it("summarises balance due, overdue invoices and quotes awaiting an answer", async () => {
    await db.invoice.deleteMany({ where: { clientId: clientB } });
    await db.quote.deleteMany({ where: { clientId: clientB } });
    const i1 = await sentInvoice(clientB, "100");
    const i2 = await sentInvoice(clientB, "50");
    await payments.recordManualPayment(admin, i2.id, { amount: "20" });
    await db.invoice.update({ where: { id: i1.id }, data: { dueDate: new Date("2020-01-01T00:00:00Z") } });
    await sentQuote(clientB);
    expect(await portal.getPortalSummary(B)).toEqual({ outstandingCents: 13000, openInvoices: 2, overdueInvoices: 1, quotesAwaiting: 1 });
  });

  it("renders PDFs for the client's own documents", async () => {
    const inv = await sentInvoice(clientA);
    const q = await sentQuote(clientA);
    const ip = await portal.renderPortalInvoicePdf(A, inv.id);
    const qp = await portal.renderPortalQuotePdf(A, q.id);
    expect(Buffer.from(ip.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(ip.filename).toBe(`${inv.number}.pdf`);
    expect(Buffer.from(qp.bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("accepting and declining quotes", () => {
  it("records the answer with who, when and from where, once", async () => {
    const q = await sentQuote(clientA);
    await portal.respondToPortalQuote(A, q.id, "ACCEPTED", { ip: "203.0.113.9" });
    const after = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.status).toBe("ACCEPTED");
    expect(after.respondedAt).not.toBeNull();
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: q.id, action: "quote.accepted.portal" } });
    expect(log).toMatchObject({ actorId: A.id, ip: "203.0.113.9" });
    expect(await db.activity.count({ where: { clientId: clientA, type: "quote.accepted", summary: { contains: q.number! } } })).toBe(1);
    await expect(portal.respondToPortalQuote(A, q.id, "DECLINED")).rejects.toBeInstanceOf(ConflictError);
    await expect(portal.respondToPortalQuote(A, q.id, "ACCEPTED")).rejects.toBeInstanceOf(ConflictError);
    // the admin can now invoice the accepted quote
    expect((await invoices.createInvoiceFromQuote(admin, q.id)).totalCents).toBe(after.totalCents);
  });

  it("lets a declined quote stay declined, and refuses expired quotes", async () => {
    const q = await sentQuote(clientA);
    await portal.respondToPortalQuote(A, q.id, "DECLINED");
    expect((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("DECLINED");
    const old = await sentQuote(clientA);
    await db.quote.update({ where: { id: old.id }, data: { validUntil: new Date("2020-01-01T00:00:00Z") } });
    await expect(portal.respondToPortalQuote(A, old.id, "ACCEPTED")).rejects.toBeInstanceOf(ConflictError);
    expect((await portal.getPortalQuote(A, old.id)).expired).toBe(true);
    expect((await db.quote.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("SENT");
  });

  it("lets only one of two simultaneous answers win", async () => {
    const q = await sentQuote(clientA);
    const r = await Promise.allSettled([
      portal.respondToPortalQuote(A, q.id, "ACCEPTED"),
      portal.respondToPortalQuote(A, q.id, "DECLINED"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityId: q.id, action: { in: ["quote.accepted.portal", "quote.declined.portal"] } } })).toBe(1);
  });

  it("emails the company when its billing email is set, and never fails the client if mail breaks", async () => {
    const prev = await db.setting.findUnique({ where: { key: "companyProfile" } });
    const withEmail = { name: "Rokket", email: "billing@rokket.test", address: null, phone: null, paymentInstructions: null };
    await db.setting.upsert({ where: { key: "companyProfile" }, update: { value: withEmail }, create: { key: "companyProfile", value: withEmail } });
    try {
      const q = await sentQuote(clientA);
      await portal.respondToPortalQuote(A, q.id, "ACCEPTED");
      await vi.waitFor(() => expect(sent.some((m) => m.to === "billing@rokket.test" && m.subject.includes(q.number!))).toBe(true));
      setMailerForTests({ send: async () => { throw new Error("down"); } });
      const q2 = await sentQuote(clientA);
      await expect(portal.respondToPortalQuote(A, q2.id, "DECLINED")).resolves.toBeTruthy();
    } finally {
      if (prev) await db.setting.update({ where: { key: "companyProfile" }, data: { value: prev.value as object } });
      else await db.setting.delete({ where: { key: "companyProfile" } });
    }
  });
});

describe("paying from the portal", () => {
  it("bills the current balance and returns the client to their own invoice page", async () => {
    const inv = await sentInvoice(clientA, "100");
    await payments.recordManualPayment(admin, inv.id, { amount: "30" });
    const { url } = await portal.startPortalCheckout(A, inv.id);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test/);
    const args = create.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(7000);
    expect(args.success_url).toMatch(new RegExp(`/portal/invoices/${inv.id}\\?paid=1$`));
    expect(args.cancel_url).toMatch(new RegExp(`/portal/invoices/${inv.id}\\?cancelled=1$`));
    expect(args.metadata.invoiceId).toBe(inv.id);
  });

  it("refuses paid invoices, and reports when Stripe is not configured", async () => {
    const inv = await sentInvoice(clientA, "10");
    await payments.recordManualPayment(admin, inv.id, { amount: "10" });
    await expect(portal.startPortalCheckout(A, inv.id)).rejects.toBeInstanceOf(ConflictError);
    const open = await sentInvoice(clientA, "10");
    setStripeForTests(undefined);
    const key = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      await expect(portal.startPortalCheckout(A, open.id)).rejects.toBeInstanceOf(StripeNotConfiguredError);
    } finally {
      if (key) process.env.STRIPE_SECRET_KEY = key;
    }
  });
});
