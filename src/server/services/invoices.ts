import type { Prisma } from "@/generated/prisma/client";
import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";
import { ConflictError, NotFoundError } from "@/server/errors";
import { formatCents } from "@/lib/money";
import { formatQuantity, minutesToQuantityMilli } from "@/lib/billing";
import { billingListSchema, fromTimeSchema, invoiceInputSchema, type LineInput } from "@/lib/validation/billing";
import { MAX_LINES } from "@/lib/validation/billing";
import {
  assertProjectBelongsToClient,
  buildLines,
  logClientActivity,
  nextNumber,
  resolveTaxRateBps,
  type Tx,
} from "./billing-core";

const NET_DAYS = 30;
const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "VOID"] as const;

function today(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------- reads ----------

export async function listInvoices(actor: ActorLike, rawQuery: unknown) {
  assertBilling(actor, "billing:read");
  const q = billingListSchema.parse(rawQuery ?? {});
  const and: Prisma.InvoiceWhereInput[] = [];
  if (q.status === "OVERDUE") {
    and.push({ status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: today() } });
  } else if (q.status && (INVOICE_STATUSES as readonly string[]).includes(q.status)) {
    and.push({ status: q.status as (typeof INVOICE_STATUSES)[number] });
  }
  if (q.clientId) and.push({ clientId: q.clientId });
  if (q.q) {
    const t = { contains: q.q, mode: "insensitive" as const };
    and.push({ OR: [{ number: t }, { client: { name: t } }] });
  }
  const where: Prisma.InvoiceWhereInput = { AND: and };
  const [items, total] = await withRetry(() =>
    db.$transaction([
      db.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { client: { select: { id: true, name: true } } },
      }),
      db.invoice.count({ where }),
    ]),
  );
  return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export async function getInvoice(actor: ActorLike, id: string) {
  assertBilling(actor, "billing:read");
  const inv = await withRetry(() =>
    db.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        project: { select: { id: true, name: true } },
        quote: { select: { id: true, number: true } },
        lines: { orderBy: { position: "asc" } },
        payments: { orderBy: { createdAt: "desc" } },
      },
    }),
  );
  if (!inv) throw new NotFoundError("Invoice not found.");
  return inv;
}

// ---------- writes ----------

async function writeLines(tx: Tx, invoiceId: string, rows: ReturnType<typeof buildLines>["rows"], timeIds?: string[]) {
  await tx.invoiceLine.deleteMany({ where: { invoiceId } });
  if (rows.length) {
    await tx.invoiceLine.createMany({
      data: rows.map((r, i) => ({ ...r, invoiceId, timeEntryId: timeIds?.[i] ?? null })),
    });
  }
}

export async function createInvoice(actor: ActorLike, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = invoiceInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await assertProjectBelongsToClient(tx, input.projectId, input.clientId);
    const calc = buildLines(input.lines, await resolveTaxRateBps(tx, input.clientId));
    const inv = await tx.invoice.create({
      data: {
        clientId: input.clientId,
        projectId: input.projectId,
        notes: input.notes,
        terms: input.terms,
        dueDate: input.dueDate,
        taxRateBps: calc.taxRateBps,
        subtotalCents: calc.subtotalCents,
        taxCents: calc.taxCents,
        totalCents: calc.totalCents,
      },
    });
    await writeLines(tx, inv.id, calc.rows);
    await logClientActivity(tx, inv.clientId, actor.id, "invoice.created", `Draft invoice created (${formatCents(inv.totalCents)})`);
    await audit({ actorId: actor.id, action: "invoice.create", entity: "Invoice", entityId: inv.id }, tx);
    return inv;
  });
}

export async function updateInvoice(actor: ActorLike, id: string, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = invoiceInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.invoice.findUnique({ where: { id }, include: { lines: { select: { timeEntryId: true, description: true } } } });
    if (!before) throw new NotFoundError("Invoice not found.");
    if (before.status !== "DRAFT") throw new ConflictError("Only draft invoices can be edited.");
    if (input.clientId !== before.clientId) throw new ConflictError("Cannot change the client of an invoice.");
    await assertProjectBelongsToClient(tx, input.projectId, input.clientId);
    const calc = buildLines(input.lines, await resolveTaxRateBps(tx, input.clientId));
    const inv = await tx.invoice.update({
      where: { id },
      data: {
        projectId: input.projectId,
        notes: input.notes,
        terms: input.terms,
        dueDate: input.dueDate,
        taxRateBps: calc.taxRateBps,
        subtotalCents: calc.subtotalCents,
        taxCents: calc.taxCents,
        totalCents: calc.totalCents,
      },
    });
    // A time link survives an edit only if a line with the same description still exists; otherwise the entry is freed.
    const links = new Map(before.lines.filter((l) => l.timeEntryId).map((l) => [l.description, l.timeEntryId as string]));
    const used = new Set<string>();
    const timeIds = calc.rows.map((r) => {
      const t = links.get(r.description);
      if (!t || used.has(t)) return undefined;
      used.add(t);
      return t;
    });
    await writeLines(tx, id, calc.rows, timeIds as string[]);
    await audit({ actorId: actor.id, action: "invoice.update", entity: "Invoice", entityId: id }, tx);
    return inv;
  });
}

export async function deleteDraftInvoice(actor: ActorLike, id: string) {
  assertBilling(actor, "billing:write");
  await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundError("Invoice not found.");
    if (inv.status !== "DRAFT") throw new ConflictError("Only draft invoices can be deleted. Void it instead.");
    await tx.invoice.delete({ where: { id } });
    await logClientActivity(tx, inv.clientId, actor.id, "invoice.deleted", "Draft invoice deleted");
    await audit({ actorId: actor.id, action: "invoice.delete", entity: "Invoice", entityId: id }, tx);
  });
}

/** DRAFT -> SENT: assigns the gapless number and dates. Emailing happens after commit (slice 3). */
export async function markInvoiceSent(actor: ActorLike, id: string) {
  assertBilling(actor, "billing:write");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id }, include: { _count: { select: { lines: true } } } });
    if (!inv) throw new NotFoundError("Invoice not found.");
    if (inv.status !== "DRAFT") throw new ConflictError("This invoice has already been sent.");
    if (inv._count.lines === 0 || inv.totalCents <= 0) throw new ConflictError("An invoice needs a positive total to be sent.");
    const issueDate = today();
    const dueDate = inv.dueDate ?? new Date(issueDate.getTime() + NET_DAYS * 86_400_000);
    const number = await nextNumber(tx, "INV");
    const sent = await tx.invoice.update({
      where: { id },
      data: { status: "SENT", number, issueDate, dueDate, sentAt: new Date() },
    });
    await logClientActivity(tx, inv.clientId, actor.id, "invoice.sent", `Invoice ${number} sent (${formatCents(inv.totalCents, inv.currency)})`);
    await audit({ actorId: actor.id, action: "invoice.send", entity: "Invoice", entityId: id, meta: { number } }, tx);
    return sent;
  });
}

/** Void a sent invoice with no payments. Frees its time entries for re-billing. */
export async function voidInvoice(actor: ActorLike, id: string) {
  assertBilling(actor, "billing:write");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundError("Invoice not found.");
    if (inv.status === "VOID") throw new ConflictError("Already void.");
    if (inv.status === "DRAFT") throw new ConflictError("Delete a draft instead of voiding it.");
    const paying = await tx.payment.count({ where: { invoiceId: id, status: { in: ["SUCCEEDED", "PENDING"] } } });
    if (paying > 0) throw new ConflictError("This invoice has payments. Refund them before voiding.");
    await tx.invoiceLine.updateMany({ where: { invoiceId: id }, data: { timeEntryId: null } });
    const v = await tx.invoice.update({ where: { id }, data: { status: "VOID" } });
    await logClientActivity(tx, inv.clientId, actor.id, "invoice.void", `Invoice ${inv.number} voided`);
    await audit({ actorId: actor.id, action: "invoice.void", entity: "Invoice", entityId: id }, tx);
    return v;
  });
}

/** Draft invoice from an ACCEPTED quote. One invoice per quote (unique quoteId). */
export async function createInvoiceFromQuote(actor: ActorLike, quoteId: string) {
  assertBilling(actor, "billing:write");
  return db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!q) throw new NotFoundError("Quote not found.");
    if (q.status !== "ACCEPTED") throw new ConflictError("Only accepted quotes can be invoiced.");
    if (await tx.invoice.findUnique({ where: { quoteId }, select: { id: true } })) {
      throw new ConflictError("This quote already has an invoice.");
    }
    const inv = await tx.invoice.create({
      data: {
        clientId: q.clientId,
        projectId: q.projectId,
        quoteId: q.id,
        currency: q.currency,
        notes: q.notes,
        terms: q.terms,
        // Accepted prices are honoured: copy the quote's snapshotted rate and totals.
        taxRateBps: q.taxRateBps,
        subtotalCents: q.subtotalCents,
        taxCents: q.taxCents,
        totalCents: q.totalCents,
      },
    });
    await tx.invoiceLine.createMany({
      data: q.lines.map((l) => ({
        invoiceId: inv.id,
        position: l.position,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPriceCents: l.unitPriceCents,
        taxable: l.taxable,
        amountCents: l.amountCents,
      })),
    });
    await logClientActivity(tx, q.clientId, actor.id, "invoice.created", `Draft invoice created from quote ${q.number}`);
    await audit({ actorId: actor.id, action: "invoice.create", entity: "Invoice", entityId: inv.id, meta: { quoteId } }, tx);
    return inv;
  });
}

/** Draft invoice from a project's completed, billable, not-yet-invoiced time. */
export async function createInvoiceFromTime(actor: ActorLike, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = fromTimeSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, clientId: true } });
    if (!project) throw new NotFoundError("Project not found.");
    const entries = await tx.timeEntry.findMany({
      where: {
        projectId: project.id,
        billable: true,
        endedAt: { not: null },
        minutes: { gt: 0 },
        rateCents: { gt: 0 },
        invoiceLine: null,
        ...(input.from || input.to
          ? { startedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: new Date(input.to.getTime() + 86_400_000) } : {}) } }
          : {}),
      },
      orderBy: { startedAt: "asc" },
      take: MAX_LINES + 1,
      include: { user: { select: { name: true } } },
    });
    if (entries.length === 0) throw new ConflictError("No unbilled billable time in that range.");
    if (entries.length > MAX_LINES) {
      throw new ConflictError(`More than ${MAX_LINES} time entries. Narrow the date range.`);
    }
    const lines: LineInput[] = entries.map((e) => ({
      description: `${project.name}: ${e.startedAt.toISOString().slice(0, 10)} ${e.user.name}${e.description ? ` - ${e.description}` : ""}`.slice(0, 500),
      quantity: minutesToQuantityMilli(e.minutes),
      unitPrice: e.rateCents,
      taxable: true,
    }));
    const calc = buildLines(lines, await resolveTaxRateBps(tx, project.clientId));
    const inv = await tx.invoice.create({
      data: {
        clientId: project.clientId,
        projectId: project.id,
        taxRateBps: calc.taxRateBps,
        subtotalCents: calc.subtotalCents,
        taxCents: calc.taxCents,
        totalCents: calc.totalCents,
      },
    });
    await writeLines(tx, inv.id, calc.rows, entries.map((e) => e.id));
    await logClientActivity(
      tx,
      project.clientId,
      actor.id,
      "invoice.created",
      `Draft invoice created from ${entries.length} time entries (${formatQuantity(lines.reduce((s, l) => s + l.quantity, 0))}h)`,
    );
    await audit({ actorId: actor.id, action: "invoice.create", entity: "Invoice", entityId: inv.id, meta: { fromTime: entries.length } }, tx);
    return inv;
  });
}

