import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { portalClientId } from "@/server/authz/portal";
import { db, withRetry } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";
import { appBaseUrl } from "@/server/app-url";
import { getMailer } from "@/server/mail";
import { balanceCents, isOverdue } from "@/lib/billing";
import { formatCents } from "@/lib/money";
import { sharedProgress } from "@/lib/progress";
import { portalQuoteResponseSchema } from "@/lib/validation/quote-response";
import { invoicePdfBytes, quotePdfBytes } from "./billing-docs";
import { checkoutForInvoice } from "./stripe-payments";
import { readCompanyProfile } from "./settings";

/** Drafts and voided invoices, and draft quotes, are internal: clients never see them. */
const INVOICE_VISIBLE = ["SENT", "PARTIALLY_PAID", "PAID"] as const;
const QUOTE_VISIBLE = ["SENT", "ACCEPTED", "DECLINED", "CHANGES_REQUESTED"] as const;

export function utcToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------- overview ----------

export async function getPortalSummary(actor: ActorLike) {
  const clientId = portalClientId(actor);
  const today = utcToday();
  const [open, quotes, sharedProjects] = await withRetry(() =>
    Promise.all([
      db.invoice.findMany({
        where: { clientId, status: { in: ["SENT", "PARTIALLY_PAID"] } },
        select: { status: true, totalCents: true, paidCents: true, dueDate: true },
        take: 500,
      }),
      db.quote.findMany({ where: { clientId, status: "SENT" }, select: { validUntil: true }, take: 500 }),
      db.project.count({ where: { clientId, visibleToClient: true, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } } }),
    ]),
  );
  return {
    outstandingCents: open.reduce((s, i) => s + balanceCents(i), 0),
    openInvoices: open.length,
    overdueInvoices: open.filter((i) => isOverdue(i, today)).length,
    quotesAwaiting: quotes.filter((q) => !q.validUntil || q.validUntil >= today).length,
    sharedProjects,
  };
}

// ---------- invoices ----------

export async function listPortalInvoices(actor: ActorLike) {
  const clientId = portalClientId(actor);
  return withRetry(() =>
    db.invoice.findMany({
      where: { clientId, status: { in: [...INVOICE_VISIBLE] } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, number: true, status: true, issueDate: true, dueDate: true, totalCents: true, paidCents: true, currency: true },
    }),
  );
}

async function loadPortalInvoice(clientId: string, id: string) {
  const inv = await withRetry(() =>
    db.invoice.findFirst({
      // clientId is part of the WHERE: another client's invoice is indistinguishable from a missing one.
      where: { id, clientId, status: { in: [...INVOICE_VISIBLE] } },
      include: {
        client: true,
        lines: { orderBy: { position: "asc" } },
        payments: { where: { status: "SUCCEEDED" }, orderBy: { createdAt: "asc" } },
      },
    }),
  );
  if (!inv) throw new NotFoundError("Invoice not found.");
  return inv;
}

/** Only what a client should see: no Stripe ids, internal references or admin notes about payments. */
export async function getPortalInvoice(actor: ActorLike, id: string) {
  const inv = await loadPortalInvoice(portalClientId(actor), id);
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    notes: inv.notes,
    terms: inv.terms,
    taxRateBps: inv.taxRateBps,
    subtotalCents: inv.subtotalCents,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    lines: inv.lines,
    payments: inv.payments.map((p) => ({
      id: p.id,
      date: p.paidAt ?? p.createdAt,
      amountCents: p.amountCents,
      refund: p.amountCents < 0,
      method: p.method,
    })),
  };
}

export async function renderPortalInvoicePdf(actor: ActorLike, id: string) {
  const inv = await loadPortalInvoice(portalClientId(actor), id);
  const company = await readCompanyProfile();
  return { bytes: await invoicePdfBytes(inv, company), filename: `${inv.number}.pdf` };
}

/** Stripe Checkout for the client's own invoice; they return to the portal afterwards. */
export async function startPortalCheckout(actor: ActorLike, id: string) {
  const inv = await loadPortalInvoice(portalClientId(actor), id);
  const base = appBaseUrl();
  return checkoutForInvoice(inv, {
    success: `${base}/portal/invoices/${id}?paid=1`,
    cancel: `${base}/portal/invoices/${id}?cancelled=1`,
  });
}

// ---------- quotes ----------

export async function listPortalQuotes(actor: ActorLike) {
  const clientId = portalClientId(actor);
  return withRetry(() =>
    db.quote.findMany({
      where: { clientId, status: { in: [...QUOTE_VISIBLE] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, number: true, title: true, status: true, validUntil: true, totalCents: true, currency: true },
    }),
  );
}

async function loadPortalQuote(clientId: string, id: string) {
  const q = await withRetry(() =>
    db.quote.findFirst({
      where: { id, clientId, status: { in: [...QUOTE_VISIBLE] } },
      include: { client: true, lines: { orderBy: { position: "asc" } } },
    }),
  );
  if (!q) throw new NotFoundError("Quote not found.");
  return q;
}

export async function getPortalQuote(actor: ActorLike, id: string) {
  const q = await loadPortalQuote(portalClientId(actor), id);
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    status: q.status,
    currency: q.currency,
    validUntil: q.validUntil,
    respondedAt: q.respondedAt,
    notes: q.notes,
    terms: q.terms,
    taxRateBps: q.taxRateBps,
    subtotalCents: q.subtotalCents,
    taxCents: q.taxCents,
    totalCents: q.totalCents,
    lines: q.lines,
    expired: q.status === "SENT" && !!q.validUntil && q.validUntil < utcToday(),
    history: await portalQuoteHistory(q.id),
  };
}

/** Explicit fields only: no author ids reach the client, just a display name. */
async function portalQuoteHistory(quoteId: string) {
  const rows = await withRetry(() => db.quoteNote.findMany({ where: { quoteId }, orderBy: { createdAt: "asc" }, take: 200 }));
  const ids = [...new Set(rows.filter((r) => !r.fromClient).map((r) => r.authorId).filter((i): i is string => !!i))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    fromClient: r.fromClient,
    action: r.action,
    body: r.body,
    createdAt: r.createdAt,
    authorName: r.fromClient ? "You" : ((r.authorId && names[r.authorId]) || "Our team"),
  }));
}

export async function renderPortalQuotePdf(actor: ActorLike, id: string) {
  const q = await loadPortalQuote(portalClientId(actor), id);
  const company = await readCompanyProfile();
  return { bytes: await quotePdfBytes(q, company), filename: `${q.number}.pdf` };
}

/**
 * The client accepts, declines or asks for edits, with an optional note (required for edits). Audited with who, when and
 * from where; only a live SENT quote can be answered, once. "Request edits" parks the quote for the admin to revise.
 */
export async function respondToPortalQuote(
  actor: ActorLike,
  id: string,
  /** Just the response ("ACCEPTED"), or the response plus the client's note. */
  raw: string | { response: string; note?: string },
  meta: { ip?: string | null } = {},
) {
  const clientId = portalClientId(actor);
  const parsed = portalQuoteResponseSchema.safeParse(typeof raw === "string" ? { response: raw } : raw);
  if (!parsed.success) throw new ConflictError(parsed.error.issues[0]?.message ?? "Invalid response.");
  const { response, note } = parsed.data;
  const result = await db.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id, clientId, status: { in: [...QUOTE_VISIBLE] } } });
    if (!q) throw new NotFoundError("Quote not found.");
    if (q.status !== "SENT") throw new ConflictError("This quote has already been answered.");
    if (q.validUntil && q.validUntil < utcToday()) throw new ConflictError("This quote has expired. Please contact us for an updated one.");
    // Compare-and-set so two simultaneous answers cannot both win.
    const won = await tx.quote.updateMany({ where: { id, status: "SENT" }, data: { status: response, respondedAt: new Date() } });
    if (won.count === 0) throw new ConflictError("This quote has already been answered.");
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    const verb = RESPONSE_VERB[response];
    await tx.quoteNote.create({ data: { quoteId: id, authorId: actor.id, fromClient: true, action: ACTION[response], body: note ?? null } });
    await tx.activity.create({
      data: {
        clientId,
        actorId: actor.id,
        type: `quote.${response.toLowerCase()}`,
        summary: `Quote ${q.number} ${verb} by ${user?.name ?? "the client"} in the portal`,
      },
    });
    await audit(
      { actorId: actor.id, action: `quote.${response.toLowerCase()}.portal`, entity: "Quote", entityId: id, ip: meta.ip ?? null, meta: { number: q.number, hasNote: !!note } },
      tx,
    );
    return { id, number: q.number, title: q.title, totalCents: q.totalCents, currency: q.currency, by: user?.name ?? "The client", note: note ?? null };
  });
  void notifyQuoteResponse(response, result, clientId);
  return result;
}

const RESPONSE_VERB = { ACCEPTED: "accepted", DECLINED: "declined", CHANGES_REQUESTED: "had edits requested" } as const;
const ACTION = { ACCEPTED: "accepted", DECLINED: "declined", CHANGES_REQUESTED: "changes_requested" } as const;

/** Best-effort heads-up to the company's billing email. Never blocks or fails the client's action. */
async function notifyQuoteResponse(
  response: keyof typeof RESPONSE_VERB,
  q: { id: string; number: string | null; title: string | null; totalCents: number; currency: string; by: string; note: string | null },
  clientId: string,
) {
  try {
    const company = await readCompanyProfile();
    if (!company.email) return;
    const what = response === "CHANGES_REQUESTED" ? "requested edits to" : response === "ACCEPTED" ? "accepted" : "declined";
    const lines = [
      `${q.by} ${what} quote ${q.number}${q.title ? ` (${q.title})` : ""} for ${formatCents(q.totalCents, q.currency)} in the client portal.`,
      ...(q.note ? [`Their note: ${q.note}`] : []),
      ...(response === "CHANGES_REQUESTED" ? [`Revise and re-send it here: ${appBaseUrl()}/quotes/${q.id}`] : []),
    ];
    await getMailer().send({
      to: company.email,
      subject: `Quote ${q.number} ${response === "CHANGES_REQUESTED" ? "needs edits" : response === "ACCEPTED" ? "accepted" : "declined"}`,
      text: lines.join("\n\n"),
      log: { kind: "quote_response", clientId },
    });
  } catch {
    /* mail not configured or provider down: the activity timeline still has it */
  }
}

// ---------- projects (read-only; only what an admin has explicitly shared) ----------

/**
 * A project is visible only if it is shared AND belongs to this client; its milestones and tasks only if they are
 * individually shared too. Every field is selected explicitly: budgets, rates, time, team, comments and files can
 * never appear here, whatever is added to the schema later.
 */
export async function listPortalProjects(actor: ActorLike) {
  const clientId = portalClientId(actor);
  return withRetry(async () => {
    const projects = await db.project.findMany({
      where: { clientId, visibleToClient: true },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 100,
      select: { id: true, name: true, status: true, startDate: true, dueDate: true },
    });
    const ids = projects.map((p) => p.id);
    const [tasks, milestones] = await Promise.all([
      db.task.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids }, visibleToClient: true }, _count: { _all: true } }),
      db.milestone.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids }, visibleToClient: true }, _count: { _all: true } }),
    ]);
    return projects.map((p) => {
      const t = tasks.filter((x) => x.projectId === p.id);
      const m = milestones.filter((x) => x.projectId === p.id);
      const total = t.reduce((n, x) => n + x._count._all, 0) + m.reduce((n, x) => n + x._count._all, 0);
      const done =
        t.filter((x) => x.status === "DONE").reduce((n, x) => n + x._count._all, 0) +
        m.filter((x) => x.status === "COMPLETED").reduce((n, x) => n + x._count._all, 0);
      return { ...p, progressPercent: sharedProgress(done, total) };
    });
  });
}

export async function getPortalProject(actor: ActorLike, id: string) {
  const clientId = portalClientId(actor);
  const p = await withRetry(() =>
    db.project.findFirst({
      where: { id, clientId, visibleToClient: true },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        startDate: true,
        dueDate: true,
        milestones: {
          where: { visibleToClient: true },
          orderBy: [{ position: "asc" }, { dueDate: "asc" }],
          select: { id: true, title: true, description: true, status: true, dueDate: true, completedAt: true },
        },
        tasks: {
          where: { visibleToClient: true },
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
          select: { id: true, title: true, description: true, status: true, dueDate: true, milestoneId: true },
        },
      },
    }),
  );
  if (!p) throw new NotFoundError("Project not found.");
  const shownMilestones = new Set(p.milestones.map((m) => m.id));
  const tasks = p.tasks.map((t) => ({ ...t, milestoneId: t.milestoneId && shownMilestones.has(t.milestoneId) ? t.milestoneId : null }));
  const total = tasks.length + p.milestones.length;
  const done = tasks.filter((t) => t.status === "DONE").length + p.milestones.filter((m) => m.status === "COMPLETED").length;
  return { ...p, tasks, progressPercent: sharedProgress(done, total) };
}
