import type { Prisma } from "@/generated/prisma/client";
import type { ActorLike } from "@/server/authz/clients";
import { ForbiddenError } from "@/server/errors";
import { db, withRetry } from "@/server/db";
import { nextEmailStatus, type MailgunEvent } from "@/lib/email-events";

export const EMAIL_LOG_PAGE_SIZE = 50;
const STATUSES = ["SENT", "DELIVERED", "FAILED", "BOUNCED", "COMPLAINED"] as const;
export type EmailStatusFilter = (typeof STATUSES)[number];

function assertAdmin(actor: ActorLike) {
  if (actor.role !== "ADMIN") throw new ForbiddenError();
}

const SELECT = {
  id: true,
  kind: true,
  toEmail: true,
  subject: true,
  status: true,
  detail: true,
  triggeredById: true,
  createdAt: true,
  updatedAt: true,
  clientId: true,
  client: { select: { id: true, name: true } },
} satisfies Prisma.EmailLogSelect;

async function withSenders<T extends { triggeredById: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.triggeredById).filter((i): i is string => !!i))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, sentBy: r.triggeredById ? (names[r.triggeredById] ?? "Unknown") : "System" }));
}

export async function listEmailLog(
  actor: ActorLike,
  q: { status?: string; kind?: string; clientId?: string; page?: number },
) {
  assertAdmin(actor);
  const where: Prisma.EmailLogWhereInput = {
    ...(q.status && (STATUSES as readonly string[]).includes(q.status) ? { status: q.status as EmailStatusFilter } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.clientId ? { clientId: q.clientId } : {}),
  };
  const page = Math.max(1, Math.floor(q.page ?? 1));
  const [rows, total] = await withRetry(() =>
    Promise.all([
      db.emailLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * EMAIL_LOG_PAGE_SIZE,
        take: EMAIL_LOG_PAGE_SIZE,
        select: SELECT,
      }),
      db.emailLog.count({ where }),
    ]),
  );
  return { rows: await withSenders(rows), total, page, pageSize: EMAIL_LOG_PAGE_SIZE };
}

export async function listClientEmails(actor: ActorLike, clientId: string, take = 10) {
  assertAdmin(actor);
  const rows = await withRetry(() =>
    db.emailLog.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take, select: SELECT }),
  );
  return withSenders(rows);
}

/** Problems in the last 30 days (failed, bounced, spam complaints), for a heads-up on the log page. */
export async function countRecentEmailProblems(actor: ActorLike): Promise<number> {
  assertAdmin(actor);
  return db.emailLog.count({
    where: { status: { in: ["FAILED", "BOUNCED", "COMPLAINED"] }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
  });
}

export type WebhookOutcome = "updated" | "unchanged" | "unknown-message";

/** Apply a verified Mailgun event. Idempotent: replays and out-of-order events never move a status backwards. */
export async function applyMailgunEvent(evt: MailgunEvent): Promise<WebhookOutcome> {
  const row = await db.emailLog.findUnique({ where: { providerId: evt.messageId }, select: { id: true, status: true } });
  if (!row) return "unknown-message"; // sent by something else on the same Mailgun domain, or logged elsewhere
  const next = nextEmailStatus(row.status, evt.event);
  if (!next) return "unchanged";
  // Compare-and-set on the status we read, so two simultaneous events cannot clobber each other.
  const res = await db.emailLog.updateMany({
    where: { id: row.id, status: row.status },
    data: { status: next, detail: evt.reason },
  });
  return res.count > 0 ? "updated" : "unchanged";
}
