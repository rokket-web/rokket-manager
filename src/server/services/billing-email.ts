import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";
import { ConflictError } from "@/server/errors";
import { payUrl, stripeConfigured } from "@/server/stripe";
import { MailNotConfiguredError, escapeHtml, getMailer, type Mailer } from "@/server/mail";
import { balanceCents } from "@/lib/billing";
import { fmtDateUtc } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { renderInvoicePdf, renderQuotePdf } from "./billing-docs";
import { logClientActivity, resolveRecipient } from "./billing-core";
import { getInvoice, markInvoiceSent } from "./invoices";
import { getQuote, markQuoteSent } from "./quotes";

export type SendResult = { emailed: boolean; to: string | null; error?: string };

function mailerOrThrow(): Mailer {
  try {
    return getMailer();
  } catch (e) {
    if (e instanceof MailNotConfiguredError) throw new ConflictError("Email is not configured yet, so nothing was sent.");
    throw e;
  }
}

async function recipientOrThrow(clientId: string, clientName: string): Promise<string> {
  const to = await resolveRecipient(clientId);
  if (!to) throw new ConflictError(`${clientName} has no billing email. Add one on the client first.`);
  return to;
}

function wrapHtml(lines: string[]): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1f">${lines
    .map((l) => (l ? `<p style="margin:0 0 12px">${escapeHtml(l)}</p>` : ""))
    .join("")}</div>`;
}

// ---------- invoices ----------

async function deliverInvoice(actor: ActorLike, id: string, mailer: Mailer, to: string): Promise<void> {
  const { bytes, filename, inv, company } = await renderInvoicePdf(actor, id);
  const link = stripeConfigured() && inv.currency === "USD" && balanceCents(inv) > 0 ? payUrl(inv.publicToken) : null;
  const lines = [
    `Hello ${inv.client.name},`,
    `Please find invoice ${inv.number} attached. Amount due: ${formatCents(balanceCents(inv), inv.currency)}, due ${fmtDateUtc(inv.dueDate)}.`,
    ...(link ? [`Pay online by card or bank transfer: ${link}`] : []),
    ...(company.paymentInstructions ? [company.paymentInstructions] : []),
    `Thank you,\n${company.name}`,
  ];
  await mailer.send({
    to,
    subject: `Invoice ${inv.number} from ${company.name}`,
    text: lines.join("\n\n"),
    html:
      wrapHtml(lines.filter((l) => !l.startsWith("Pay online")).flatMap((l) => l.split("\n"))) +
      (link ? `<p style="font-family:Arial,sans-serif;font-size:14px"><a href="${escapeHtml(link)}">Pay this invoice online</a></p>` : ""),
    replyTo: company.email,
    attachments: [{ filename, content: bytes, contentType: "application/pdf" }],
  });
  await db.$transaction(async (tx) => {
    await logClientActivity(tx, inv.clientId, actor.id, "invoice.emailed", `Invoice ${inv.number} emailed to ${to}`);
    await audit({ actorId: actor.id, action: "invoice.email", entity: "Invoice", entityId: id, meta: { to } }, tx);
  });
}

/**
 * DRAFT -> SENT, then email. Recipient and mail config are checked BEFORE the invoice is locked,
 * so the common failures leave it a draft. A delivery failure after locking is reported, and Resend works.
 */
export async function sendInvoice(actor: ActorLike, id: string): Promise<SendResult> {
  assertBilling(actor, "billing:write");
  const inv = await getInvoice(actor, id);
  if (inv.status !== "DRAFT") throw new ConflictError("This invoice has already been sent.");
  const to = await recipientOrThrow(inv.clientId, inv.client.name);
  const mailer = mailerOrThrow();
  await markInvoiceSent(actor, id);
  try {
    await deliverInvoice(actor, id, mailer, to);
    return { emailed: true, to };
  } catch (e) {
    console.error("[invoice email]", e instanceof Error ? e.name : e);
    return { emailed: false, to, error: "The invoice was marked sent but the email failed. Use Resend email." };
  }
}

export async function resendInvoice(actor: ActorLike, id: string): Promise<SendResult> {
  assertBilling(actor, "billing:write");
  const inv = await getInvoice(actor, id);
  if (inv.status !== "SENT" && inv.status !== "PARTIALLY_PAID") {
    throw new ConflictError("Only sent, unpaid invoices can be emailed.");
  }
  const to = await recipientOrThrow(inv.clientId, inv.client.name);
  const mailer = mailerOrThrow();
  try {
    await deliverInvoice(actor, id, mailer, to);
    return { emailed: true, to };
  } catch (e) {
    console.error("[invoice email]", e instanceof Error ? e.name : e);
    return { emailed: false, to, error: "The email could not be sent. Please try again." };
  }
}

// ---------- quotes ----------

async function deliverQuote(actor: ActorLike, id: string, mailer: Mailer, to: string): Promise<void> {
  const { bytes, filename, quote, company } = await renderQuotePdf(actor, id);
  const lines = [
    `Hello ${quote.client.name},`,
    `Please find quote ${quote.number}${quote.title ? ` (${quote.title})` : ""} attached. Total: ${formatCents(quote.totalCents, quote.currency)}, valid until ${fmtDateUtc(quote.validUntil)}.`,
    "Reply to this email to accept or ask any questions.",
    `Thank you,\n${company.name}`,
  ];
  await mailer.send({
    to,
    subject: `Quote ${quote.number} from ${company.name}`,
    text: lines.join("\n\n"),
    html: wrapHtml(lines.flatMap((l) => l.split("\n"))),
    replyTo: company.email,
    attachments: [{ filename, content: bytes, contentType: "application/pdf" }],
  });
  await db.$transaction(async (tx) => {
    await logClientActivity(tx, quote.clientId, actor.id, "quote.emailed", `Quote ${quote.number} emailed to ${to}`);
    await audit({ actorId: actor.id, action: "quote.email", entity: "Quote", entityId: id, meta: { to } }, tx);
  });
}

export async function sendQuote(actor: ActorLike, id: string): Promise<SendResult> {
  assertBilling(actor, "billing:write");
  const q = await getQuote(actor, id);
  if (q.status !== "DRAFT") throw new ConflictError("This quote has already been sent.");
  const to = await recipientOrThrow(q.clientId, q.client.name);
  const mailer = mailerOrThrow();
  await markQuoteSent(actor, id);
  try {
    await deliverQuote(actor, id, mailer, to);
    return { emailed: true, to };
  } catch (e) {
    console.error("[quote email]", e instanceof Error ? e.name : e);
    return { emailed: false, to, error: "The quote was marked sent but the email failed. Use Resend email." };
  }
}

export async function resendQuote(actor: ActorLike, id: string): Promise<SendResult> {
  assertBilling(actor, "billing:write");
  const q = await getQuote(actor, id);
  if (q.status !== "SENT") throw new ConflictError("Only sent quotes can be emailed.");
  const to = await recipientOrThrow(q.clientId, q.client.name);
  const mailer = mailerOrThrow();
  try {
    await deliverQuote(actor, id, mailer, to);
    return { emailed: true, to };
  } catch (e) {
    console.error("[quote email]", e instanceof Error ? e.name : e);
    return { emailed: false, to, error: "The email could not be sent. Please try again." };
  }
}
