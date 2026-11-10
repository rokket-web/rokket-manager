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
import { invoicePdfBytes, quotePdfBytes } from "./billing-docs";
import { checkoutForInvoice } from "./stripe-payments";
import { readCompanyProfile } from "./settings";

/** Drafts and voided invoices, and draft quotes, are internal: clients never see them. */
const INVOICE_VISIBLE = ["SENT", "PARTIALLY_PAID", "PAID"] as const;
const QUOTE_VISIBLE = ["SENT", "ACCEPTED", "DECLINED"] as const;

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
  };
}

export async function renderPortalQuotePdf(actor: ActorLike, id: string) {
  const q = await loadPortalQuote(portalClientId(actor), id);
  const company = await readCompanyProfile();
  return { bytes: await quotePdfBytes(q, company), filename: `${q.number}.pdf` };
}

/** The client accepts or declines. Audited with who, when and from where; only a live SENT quote can be answered, once. */
export async function respondToPortalQuote(
  actor: ActorLike,
  id: string,
  response: "ACCEPTED" | "DECLINED",
  meta: { ip?: string | null } = {},
) {
  const clientId = portalClientId(actor);
  if (response !== "ACCEPTED" && response !== "DECLINED") throw new ConflictError("Invalid response.");
  const result = await db.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id, clientId, status: { in: [...QUOTE_VISIBLE] } } });
    if (!q) throw new NotFoundError("Quote not found.");
    if (q.status !== "SENT") throw new ConflictError("This quote has already been answered.");
    if (q.validUntil && q.validUntil < utcToday()) throw new ConflictError("This quote has expired. Please contact us for an updated one.");
    // Compare-and-set so two simultaneous answers cannot both win.
    const won = await tx.quote.updateMany({ where: { id, status: "SENT" }, data: { status: response, respondedAt: new Date() } });
    if (won.count === 0) throw new ConflictError("This quote has already been answered.");
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    const verb = response === "ACCEPTED" ? "accepted" : "declined";
    await tx.activity.create({
      data: { clientId, actorId: actor.id, type: `quote.${verb}`, summary: `Quote ${q.number} ${verb} by ${user?.name ?? "the client"} in the portal` },
    });
    await audit(
      { actorId: actor.id, action: `quote.${verb}.portal`, entity: "Quote", entityId: id, ip: meta.ip ?? null, meta: { number: q.number } },
      tx,
    );
    return { number: q.number, title: q.title, totalCents: q.totalCents, currency: q.currency, by: user?.name ?? "The client" };
  });
  void notifyQuoteResponse(response, result);
  return result;
}

/** Best-effort heads-up to the company's billing email. Never blocks or fails the client's action. */
async function notifyQuoteResponse(
  response: "ACCEPTED" | "DECLINED",
  q: { number: string | null; title: string | null; totalCents: number; currency: string; by: string },
) {
  try {
    const company = await readCompanyProfile();
    if (!company.email) return;
    const verb = response === "ACCEPTED" ? "accepted" : "declined";
    await getMailer().send({
      to: company.email,
      subject: `Quote ${q.number} ${verb}`,
      text: `${q.by} ${verb} quote ${q.number}${q.title ? ` (${q.title})` : ""} for ${formatCents(q.totalCents, q.currency)} in the client portal.`,
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
