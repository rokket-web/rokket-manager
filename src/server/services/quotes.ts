import type { Prisma } from "@/generated/prisma/client";
import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";
import { ConflictError, NotFoundError } from "@/server/errors";
import { formatCents } from "@/lib/money";
import { billingListSchema, quoteInputSchema } from "@/lib/validation/billing";
import {
  assertProjectBelongsToClient,
  buildLines,
  logClientActivity,
  nextNumber,
  resolveTaxRateBps,
  type Tx,
} from "./billing-core";

const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"] as const;
const VALID_DAYS = 30;

export async function listQuotes(actor: ActorLike, rawQuery: unknown) {
  assertBilling(actor, "billing:read");
  const q = billingListSchema.parse(rawQuery ?? {});
  const and: Prisma.QuoteWhereInput[] = [];
  if (q.status && (QUOTE_STATUSES as readonly string[]).includes(q.status)) {
    and.push({ status: q.status as (typeof QUOTE_STATUSES)[number] });
  }
  if (q.clientId) and.push({ clientId: q.clientId });
  if (q.q) {
    const t = { contains: q.q, mode: "insensitive" as const };
    and.push({ OR: [{ number: t }, { title: t }, { client: { name: t } }] });
  }
  const where: Prisma.QuoteWhereInput = { AND: and };
  const [items, total] = await withRetry(() =>
    db.$transaction([
      db.quote.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { client: { select: { id: true, name: true } } },
      }),
      db.quote.count({ where }),
    ]),
  );
  return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export async function getQuote(actor: ActorLike, id: string) {
  assertBilling(actor, "billing:read");
  const quote = await withRetry(() =>
    db.quote.findUnique({
      where: { id },
      include: {
        client: true,
        project: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true, status: true } },
        lines: { orderBy: { position: "asc" } },
      },
    }),
  );
  if (!quote) throw new NotFoundError("Quote not found.");
  return quote;
}

async function writeLines(tx: Tx, quoteId: string, rows: ReturnType<typeof buildLines>["rows"]) {
  await tx.quoteLine.deleteMany({ where: { quoteId } });
  await tx.quoteLine.createMany({ data: rows.map((r) => ({ ...r, quoteId })) });
}

export async function createQuote(actor: ActorLike, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = quoteInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await assertProjectBelongsToClient(tx, input.projectId, input.clientId);
    const calc = buildLines(input.lines, await resolveTaxRateBps(tx, input.clientId));
    const quote = await tx.quote.create({
      data: {
        clientId: input.clientId,
        projectId: input.projectId,
        title: input.title,
        notes: input.notes,
        terms: input.terms,
        validUntil: input.validUntil,
        taxRateBps: calc.taxRateBps,
        subtotalCents: calc.subtotalCents,
        taxCents: calc.taxCents,
        totalCents: calc.totalCents,
      },
    });
    await writeLines(tx, quote.id, calc.rows);
    await logClientActivity(tx, quote.clientId, actor.id, "quote.created", `Draft quote created (${formatCents(quote.totalCents)})`);
    await audit({ actorId: actor.id, action: "quote.create", entity: "Quote", entityId: quote.id }, tx);
    return quote;
  });
}

export async function updateQuote(actor: ActorLike, id: string, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = quoteInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.quote.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Quote not found.");
    if (before.status !== "DRAFT") throw new ConflictError("Only draft quotes can be edited.");
    if (input.clientId !== before.clientId) throw new ConflictError("Cannot change the client of a quote.");
    await assertProjectBelongsToClient(tx, input.projectId, input.clientId);
    const calc = buildLines(input.lines, await resolveTaxRateBps(tx, input.clientId));
    const quote = await tx.quote.update({
      where: { id },
      data: {
        projectId: input.projectId,
        title: input.title,
        notes: input.notes,
        terms: input.terms,
        validUntil: input.validUntil,
        taxRateBps: calc.taxRateBps,
        subtotalCents: calc.subtotalCents,
        taxCents: calc.taxCents,
        totalCents: calc.totalCents,
      },
    });
    await writeLines(tx, id, calc.rows);
    await audit({ actorId: actor.id, action: "quote.update", entity: "Quote", entityId: id }, tx);
    return quote;
  });
}

export async function deleteDraftQuote(actor: ActorLike, id: string) {
  assertBilling(actor, "billing:write");
  await db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id } });
    if (!q) throw new NotFoundError("Quote not found.");
    if (q.status !== "DRAFT") throw new ConflictError("Only draft quotes can be deleted.");
    await tx.quote.delete({ where: { id } });
    await logClientActivity(tx, q.clientId, actor.id, "quote.deleted", "Draft quote deleted");
    await audit({ actorId: actor.id, action: "quote.delete", entity: "Quote", entityId: id }, tx);
  });
}

export async function markQuoteSent(actor: ActorLike, id: string) {
  assertBilling(actor, "billing:write");
  return db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id }, include: { _count: { select: { lines: true } } } });
    if (!q) throw new NotFoundError("Quote not found.");
    if (q.status !== "DRAFT") throw new ConflictError("This quote has already been sent.");
    if (q._count.lines === 0) throw new ConflictError("A quote needs at least one line.");
    const number = await nextNumber(tx, "Q");
    const validUntil = q.validUntil ?? new Date(Date.now() + VALID_DAYS * 86_400_000);
    const sent = await tx.quote.update({
      where: { id },
      data: {
        status: "SENT",
        number,
        sentAt: new Date(),
        validUntil: new Date(Date.UTC(validUntil.getUTCFullYear(), validUntil.getUTCMonth(), validUntil.getUTCDate())),
      },
    });
    await logClientActivity(tx, q.clientId, actor.id, "quote.sent", `Quote ${number} sent (${formatCents(q.totalCents, q.currency)})`);
    await audit({ actorId: actor.id, action: "quote.send", entity: "Quote", entityId: id, meta: { number } }, tx);
    return sent;
  });
}

/** Admin records the client's answer (the portal accept/decline link arrives in Phase 5). */
export async function recordQuoteResponse(actor: ActorLike, id: string, response: "ACCEPTED" | "DECLINED") {
  assertBilling(actor, "billing:write");
  if (response !== "ACCEPTED" && response !== "DECLINED") throw new ConflictError("Invalid response.");
  return db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id } });
    if (!q) throw new NotFoundError("Quote not found.");
    if (q.status !== "SENT") throw new ConflictError("Only a sent quote can be accepted or declined.");
    const updated = await tx.quote.update({ where: { id }, data: { status: response, respondedAt: new Date() } });
    await logClientActivity(tx, q.clientId, actor.id, `quote.${response.toLowerCase()}`, `Quote ${q.number} ${response.toLowerCase()}`);
    await audit({ actorId: actor.id, action: `quote.${response.toLowerCase()}`, entity: "Quote", entityId: id }, tx);
    return updated;
  });
}
