import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import * as invoices from "./invoices";
import * as quotes from "./quotes";
import * as payments from "./payments";
import * as billingEmail from "./billing-email";
import { setMailerForTests, type MailMessage } from "@/server/mail";

const P = `ZZTEST-${Math.random().toString(36).slice(2, 8)}`;
let admin: ActorLike;
let staff: ActorLike;
let clientId: string;
let projectId: string;

const line = (description: string, quantity = "1", unitPrice = "100", taxable = true) => ({
  description,
  quantity,
  unitPrice,
  taxable,
});

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  const s = await db.user.findUniqueOrThrow({ where: { email: "staff@rokket.test" } });
  admin = { id: a.id, role: "ADMIN" };
  staff = { id: s.id, role: "STAFF" };
  const c = await db.client.create({ data: { name: `${P} Client`, taxRateBps: 825 } });
  clientId = c.id;
  const p = await db.project.create({ data: { clientId, name: `${P} Project`, hourlyRateCents: 10000 } });
  projectId = p.id;
});

afterAll(async () => {
  await db.payment.deleteMany({ where: { invoice: { clientId } } });
  await db.invoice.deleteMany({ where: { clientId } });
  await db.quote.deleteMany({ where: { clientId } });
  await db.timeEntry.deleteMany({ where: { projectId } });
  await db.project.deleteMany({ where: { clientId } });
  await db.activity.deleteMany({ where: { clientId } });
  await db.client.deleteMany({ where: { id: clientId } });
  await db.$disconnect();
});

describe("billing authorization", () => {
  it("staff and portal users cannot touch billing", async () => {
    await expect(invoices.listInvoices(staff, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(quotes.createQuote(staff, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      invoices.createInvoice({ id: "x", role: "CLIENT", clientId }, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("invoice lifecycle", () => {
  it("computes totals server-side and snapshots the client tax rate", async () => {
    const inv = await invoices.createInvoice(admin, {
      clientId,
      lines: [line("Design", "2", "150"), line("Hosting", "1", "50", false)],
    });
    expect(inv.number).toBeNull();
    expect(inv.taxRateBps).toBe(825);
    expect(inv.subtotalCents).toBe(35000);
    expect(inv.taxCents).toBe(2475);
    expect(inv.totalCents).toBe(37475);
  });

  it("rejects projects from another client and oversized totals", async () => {
    await expect(
      invoices.createInvoice(admin, { clientId, projectId: "nope", lines: [line("x")] }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      invoices.createInvoice(admin, { clientId, lines: [line("x", "1000", "9000000")] }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("assigns gapless numbers on send and locks the invoice", async () => {
    const a = await invoices.createInvoice(admin, { clientId, lines: [line("A")] });
    const b = await invoices.createInvoice(admin, { clientId, lines: [line("B")] });
    const sa = await invoices.markInvoiceSent(admin, a.id);
    const sb = await invoices.markInvoiceSent(admin, b.id);
    expect(sa.number).toMatch(/^INV-\d{4}$/);
    expect(Number(sb.number!.slice(4))).toBe(Number(sa.number!.slice(4)) + 1);
    expect(sa.dueDate).not.toBeNull();
    await expect(invoices.markInvoiceSent(admin, a.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(invoices.updateInvoice(admin, a.id, { clientId, lines: [line("A2")] })).rejects.toBeInstanceOf(ConflictError);
    await expect(invoices.deleteDraftInvoice(admin, a.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("tracks partial and full manual payments, and refuses overpayment", async () => {
    const d = await invoices.createInvoice(admin, { clientId, lines: [line("Pay", "1", "100", false)] });
    await expect(payments.recordManualPayment(admin, d.id, { amount: "10" })).rejects.toBeInstanceOf(ConflictError);
    await invoices.markInvoiceSent(admin, d.id);
    const part = await payments.recordManualPayment(admin, d.id, { amount: "40", reference: "check 1" });
    expect(part.invoice.status).toBe("PARTIALLY_PAID");
    expect(part.invoice.paidCents).toBe(4000);
    await expect(payments.recordManualPayment(admin, d.id, { amount: "60.01" })).rejects.toBeInstanceOf(ConflictError);
    const full = await payments.recordManualPayment(admin, d.id, { amount: "60" });
    expect(full.invoice.status).toBe("PAID");
    expect(full.invoice.paidAt).not.toBeNull();
    await expect(invoices.voidInvoice(admin, d.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("concurrent payments cannot overpay", async () => {
    const d = await invoices.createInvoice(admin, { clientId, lines: [line("Race", "1", "100", false)] });
    await invoices.markInvoiceSent(admin, d.id);
    const results = await Promise.allSettled([
      payments.recordManualPayment(admin, d.id, { amount: "100" }),
      payments.recordManualPayment(admin, d.id, { amount: "100" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: d.id } });
    expect(inv.paidCents).toBe(10000);
  });

  it("voids an unpaid sent invoice", async () => {
    const d = await invoices.createInvoice(admin, { clientId, lines: [line("Void me")] });
    await expect(invoices.voidInvoice(admin, d.id)).rejects.toBeInstanceOf(ConflictError); // draft
    await invoices.markInvoiceSent(admin, d.id);
    expect((await invoices.voidInvoice(admin, d.id)).status).toBe("VOID");
  });
});

describe("invoice from time", () => {
  it("bills each entry once and frees time when voided", async () => {
    const start = new Date("2026-03-02T10:00:00Z");
    const e = await db.timeEntry.create({
      data: {
        projectId, userId: admin.id, startedAt: start, endedAt: new Date(start.getTime() + 90 * 60000),
        minutes: 90, billable: true, rateCents: 10000, description: "Build",
      },
    });
    const inv = await invoices.createInvoiceFromTime(admin, { projectId });
    expect(inv.subtotalCents).toBe(15000); // 1.5h x $100
    await expect(invoices.createInvoiceFromTime(admin, { projectId })).rejects.toBeInstanceOf(ConflictError);
    await invoices.markInvoiceSent(admin, inv.id);
    await invoices.voidInvoice(admin, inv.id);
    const again = await invoices.createInvoiceFromTime(admin, { projectId });
    expect(again.subtotalCents).toBe(15000);
    await invoices.deleteDraftInvoice(admin, again.id);
    expect(await db.invoiceLine.count({ where: { timeEntryId: e.id } })).toBe(0);
  });
});

describe("quotes", () => {
  it("runs draft -> sent -> accepted -> invoice, once", async () => {
    const q = await quotes.createQuote(admin, { clientId, title: "Site", lines: [line("Build site", "1", "1000")] });
    await expect(invoices.createInvoiceFromQuote(admin, q.id)).rejects.toBeInstanceOf(ConflictError);
    const sent = await quotes.markQuoteSent(admin, q.id);
    expect(sent.number).toMatch(/^Q-\d{4}$/);
    await expect(quotes.updateQuote(admin, q.id, { clientId, lines: [line("x")] })).rejects.toBeInstanceOf(ConflictError);
    await quotes.recordQuoteResponse(admin, q.id, "ACCEPTED");
    await expect(quotes.recordQuoteResponse(admin, q.id, "DECLINED")).rejects.toBeInstanceOf(ConflictError);
    const inv = await invoices.createInvoiceFromQuote(admin, q.id);
    expect(inv.totalCents).toBe(sent.totalCents);
    await expect(invoices.createInvoiceFromQuote(admin, q.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("sending and email", () => {
  const sent: MailMessage[] = [];
  const ok = { send: async (m: MailMessage) => void sent.push(m) };
  const failing = { send: async () => { throw new Error("boom"); } };
  let noEmailClientId: string;

  beforeAll(async () => {
    noEmailClientId = (await db.client.create({ data: { name: `${P} NoEmail` } })).id;
    await db.client.update({ where: { id: clientId }, data: { billingEmail: "billing@acme.test" } });
  });
  afterAll(async () => {
    setMailerForTests(undefined);
    await db.invoice.deleteMany({ where: { clientId: noEmailClientId } });
    await db.activity.deleteMany({ where: { clientId: noEmailClientId } });
    await db.client.deleteMany({ where: { id: noEmailClientId } });
  });

  it("refuses to send, and leaves the invoice a draft, when the client has no email", async () => {
    setMailerForTests(ok);
    const inv = await invoices.createInvoice(admin, { clientId: noEmailClientId, lines: [line("x")] });
    await expect(billingEmail.sendInvoice(admin, inv.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("DRAFT");
  });

  it("refuses to send, and leaves the invoice a draft, when mail is not configured", async () => {
    setMailerForTests(undefined);
    const prev = { ...process.env };
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAIL_DRIVER;
    const inv = await invoices.createInvoice(admin, { clientId, lines: [line("x")] });
    await expect(billingEmail.sendInvoice(admin, inv.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("DRAFT");
    Object.assign(process.env, prev);
  });

  it("sends the invoice with a PDF attachment to the billing email", async () => {
    setMailerForTests(ok);
    const inv = await invoices.createInvoice(admin, { clientId, lines: [line("Work", "2", "100")] });
    const r = await billingEmail.sendInvoice(admin, inv.id);
    expect(r).toMatchObject({ emailed: true, to: "billing@acme.test" });
    const m = sent.at(-1)!;
    expect(m.to).toBe("billing@acme.test");
    expect(m.subject).toMatch(/^Invoice INV-\d{4}/);
    expect(m.attachments![0].contentType).toBe("application/pdf");
    expect(Buffer.from(m.attachments![0].content.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SENT");
    // already sent -> conflict; resend works
    await expect(billingEmail.sendInvoice(admin, inv.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await billingEmail.resendInvoice(admin, inv.id)).emailed).toBe(true);
  });

  it("keeps the invoice sent and reports failure when delivery fails, then resend recovers", async () => {
    setMailerForTests(failing);
    const inv = await invoices.createInvoice(admin, { clientId, lines: [line("Work")] });
    const r = await billingEmail.sendInvoice(admin, inv.id);
    expect(r.emailed).toBe(false);
    expect(r.error).toMatch(/Resend/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SENT");
    setMailerForTests(ok);
    expect((await billingEmail.resendInvoice(admin, inv.id)).emailed).toBe(true);
  });

  it("sends quotes and only resends sent quotes", async () => {
    setMailerForTests(ok);
    const q = await quotes.createQuote(admin, { clientId, lines: [line("Scope")] });
    await expect(billingEmail.resendQuote(admin, q.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await billingEmail.sendQuote(admin, q.id)).emailed).toBe(true);
    expect(sent.at(-1)!.subject).toMatch(/^Quote Q-\d{4}/);
  });

  it("staff cannot send or resend", async () => {
    await expect(billingEmail.sendInvoice(staff, "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(billingEmail.resendQuote(staff, "x")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
