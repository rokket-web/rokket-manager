import { clientScope, type ActorLike } from "@/server/authz/clients";
import { projectScope } from "@/server/authz/projects";
import { db, withRetry } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { balanceCents, isOverdue } from "@/lib/billing";
import {
  daysBetween,
  monthBoundsUtc,
  plural,
  sortAttention,
  startOfWeekUtc,
  sumByCurrency,
  utcToday,
  type AttentionItem,
  type Money,
} from "@/lib/dashboard";
import { formatCents } from "@/lib/money";
import { sharedProgress } from "@/lib/progress";

const DAY = 86_400_000;
const QUOTE_STALE_DAYS = 7;
/** Staff never see money: keep billing, email and messaging activity off their feed. */
const MONEY_ACTIVITY_PREFIXES = ["invoice.", "quote.", "payment.", "message.", "email.", "installment."];

export type DashboardData = {
  isAdmin: boolean;
  /** Admin only. */
  money: null | {
    outstanding: Money[];
    overdue: Money[];
    overdueCount: number;
    billedThisMonth: Money[];
    billedLastMonth: Money[];
    unreadMessages: number;
    unreadClients: { id: string; name: string; count: number }[];
  };
  attention: AttentionItem[]; // admin only (empty for staff)
  hoursWeekMinutes: number;
  timer: null | { startedAt: Date; project: { id: string; name: string }; task: { id: string; title: string } | null };
  openTasks: number;
  overdueTasks: number;
  tasks: { id: string; title: string; status: string; priority: string; dueDate: Date | null; projectId: string; projectName: string; overdue: boolean }[];
  projects: { id: string; name: string; clientName: string; status: string; dueDate: Date | null; progress: number | null; overdue: boolean }[];
  activity: { id: string; summary: string; clientId: string; clientName: string; actorName: string; createdAt: Date }[];
};

export async function getDashboard(actor: ActorLike, now: Date = new Date()): Promise<DashboardData> {
  if (actor.role !== "ADMIN" && actor.role !== "STAFF") throw new ForbiddenError();
  const isAdmin = actor.role === "ADMIN";
  const today = utcToday(now);
  const weekStart = startOfWeekUtc(now);
  const soon = new Date(today.getTime() + 7 * DAY);

  const [timeAgg, timer, openTasks, overdueTasks, taskRows, projectRows, activityRows, money] = await withRetry(() =>
    Promise.all([
      db.timeEntry.aggregate({
        where: { userId: actor.id, startedAt: { gte: weekStart }, endedAt: { not: null } },
        _sum: { minutes: true },
      }),
      db.timeEntry.findFirst({
        where: { userId: actor.id, endedAt: null },
        select: { startedAt: true, project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
      }),
      db.task.count({ where: { assigneeId: actor.id, status: { not: "DONE" }, project: projectScope(actor) } }),
      db.task.count({ where: { assigneeId: actor.id, status: { not: "DONE" }, dueDate: { lt: today }, project: projectScope(actor) } }),
      db.task.findMany({
        where: { assigneeId: actor.id, status: { not: "DONE" }, dueDate: { lte: soon }, project: projectScope(actor) },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
        take: 8,
        select: { id: true, title: true, status: true, priority: true, dueDate: true, projectId: true, project: { select: { name: true } } },
      }),
      db.project.findMany({
        where: { status: "ACTIVE", ...projectScope(actor) },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
        take: 6,
        select: { id: true, name: true, status: true, dueDate: true, client: { select: { name: true } } },
      }),
      db.activity.findMany({
        where: {
          client: clientScope(actor),
          ...(isAdmin ? {} : { NOT: MONEY_ACTIVITY_PREFIXES.map((p) => ({ type: { startsWith: p } })) }),
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, summary: true, actorId: true, createdAt: true, clientId: true, client: { select: { name: true } } },
      }),
      isAdmin ? adminMoney(today, now) : Promise.resolve(null),
    ]),
  );

  // Project progress = done tasks / all tasks (one grouped query for all listed projects).
  const projectIds = projectRows.map((p) => p.id);
  const counts = projectIds.length
    ? await db.task.groupBy({ by: ["projectId", "status"], where: { projectId: { in: projectIds } }, _count: { _all: true } })
    : [];
  const progress = (id: string) => {
    const mine = counts.filter((c) => c.projectId === id);
    const total = mine.reduce((s, c) => s + c._count._all, 0);
    const done = mine.filter((c) => c.status === "DONE").reduce((s, c) => s + c._count._all, 0);
    return sharedProgress(done, total);
  };

  const actorIds = [...new Set(activityRows.map((a) => a.actorId).filter((i): i is string => !!i))];
  const users = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));

  // Time still running counts toward this week from whichever is later: its start or Monday.
  const runningMinutes = timer ? Math.max(0, Math.floor((now.getTime() - Math.max(timer.startedAt.getTime(), weekStart.getTime())) / 60_000)) : 0;

  return {
    isAdmin,
    money: money?.stats ?? null,
    attention: money?.attention ?? [],
    hoursWeekMinutes: (timeAgg._sum.minutes ?? 0) + runningMinutes,
    timer,
    openTasks,
    overdueTasks,
    tasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      projectId: t.projectId,
      projectName: t.project.name,
      overdue: !!t.dueDate && t.dueDate < today,
    })),
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.client.name,
      status: p.status,
      dueDate: p.dueDate,
      progress: progress(p.id),
      overdue: !!p.dueDate && p.dueDate < today,
    })),
    activity: activityRows.map((a) => ({
      id: a.id,
      summary: a.summary,
      clientId: a.clientId,
      clientName: a.client.name,
      actorName: a.actorId ? (names[a.actorId] ?? "Unknown") : "System",
      createdAt: a.createdAt,
    })),
  };
}

/** Everything money- or admin-related. Only ever called for ADMIN. */
async function adminMoney(today: Date, now: Date) {
  const { start, next, prevStart } = monthBoundsUtc(now);
  const billed = (from: Date, to: Date) =>
    db.invoice.groupBy({
      by: ["currency"],
      where: { status: { in: ["SENT", "PARTIALLY_PAID", "PAID"] }, sentAt: { gte: from, lt: to } },
      _sum: { totalCents: true },
    });
  const [open, thisMonth, lastMonth, staleQuotes, editQuotes, readyInstallments, emailProblems, unread] = await Promise.all([
    db.invoice.findMany({
      where: { status: { in: ["SENT", "PARTIALLY_PAID"] } },
      orderBy: { dueDate: { sort: "asc", nulls: "last" } },
      take: 1000,
      select: { id: true, number: true, status: true, currency: true, totalCents: true, paidCents: true, dueDate: true, client: { select: { name: true } } },
    }),
    billed(start, next),
    billed(prevStart, start),
    db.quote.findMany({
      where: { status: "SENT", sentAt: { lt: new Date(now.getTime() - QUOTE_STALE_DAYS * DAY) } },
      orderBy: { sentAt: "asc" },
      take: 5,
      select: { id: true, number: true, sentAt: true, client: { select: { name: true } } },
    }),
    db.quote.findMany({
      where: { status: "CHANGES_REQUESTED" },
      orderBy: { respondedAt: "asc" },
      take: 5,
      select: { id: true, number: true, respondedAt: true, client: { select: { name: true } } },
    }),
    db.billingInstallment.findMany({
      where: { invoiceId: null, project: { status: "COMPLETED", billingType: "FLAT_FEE" } },
      orderBy: { updatedAt: "asc" },
      take: 5,
      select: { label: true, amountCents: true, project: { select: { id: true, name: true, currency: true, client: { select: { name: true } } } } },
    }),
    db.emailLog.count({
      where: { status: { in: ["FAILED", "BOUNCED", "COMPLAINED"] }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } },
    }),
    db.message.groupBy({ by: ["clientId"], where: { fromClient: true, readAt: null }, _count: { _all: true }, orderBy: { _count: { clientId: "desc" } }, take: 20 }),
  ]);

  const overdue = open.filter((i) => isOverdue(i, today));
  const unreadClientRows = unread.length
    ? await db.client.findMany({ where: { id: { in: unread.map((u) => u.clientId) } }, select: { id: true, name: true } })
    : [];
  const clientName = Object.fromEntries(unreadClientRows.map((c) => [c.id, c.name]));
  const unreadClients = unread.map((u) => ({ id: u.clientId, name: clientName[u.clientId] ?? "Unknown", count: u._count._all }));
  const unreadMessages = unreadClients.reduce((s, c) => s + c.count, 0);

  const attention: AttentionItem[] = [
    ...overdue.slice(0, 5).map<AttentionItem>((i) => ({
      id: `inv-${i.id}`,
      severity: "high",
      title: `${i.number ?? "Invoice"} is overdue`,
      detail: `${i.client.name} · ${formatCents(balanceCents(i), i.currency)} · ${plural(daysBetween(i.dueDate!, today), "day")} late`,
      href: `/invoices/${i.id}`,
    })),
    ...editQuotes.map<AttentionItem>((q) => ({
      id: `edits-${q.id}`,
      severity: "high",
      title: `${q.number ?? "Quote"}: ${q.client.name} asked for edits`,
      detail: q.respondedAt ? `Requested ${plural(daysBetween(q.respondedAt, now), "day")} ago` : "Revise and re-send it",
      href: `/quotes/${q.id}`,
    })),
    ...(emailProblems > 0
      ? [
          {
            id: "email-problems",
            severity: "high" as const,
            title: `${plural(emailProblems, "email")} failed or bounced this week`,
            detail: "Check the addresses in the email log",
            href: "/settings/email-log?status=BOUNCED",
          },
        ]
      : []),
    ...unreadClients.slice(0, 3).map<AttentionItem>((c) => ({
      id: `msg-${c.id}`,
      severity: "medium",
      title: `${c.name} sent ${plural(c.count, "message")}`,
      detail: "Waiting for a reply",
      href: `/clients/${c.id}?tab=messages`,
    })),
    ...staleQuotes.map<AttentionItem>((q) => ({
      id: `quote-${q.id}`,
      severity: "medium",
      title: `${q.number ?? "Quote"} has no answer yet`,
      detail: `${q.client.name} · sent ${plural(daysBetween(q.sentAt!, now), "day")} ago`,
      href: `/quotes/${q.id}`,
    })),
    ...readyInstallments.map<AttentionItem>((r, idx) => ({
      id: `inst-${r.project.id}-${idx}`,
      severity: "low",
      title: `Ready to invoice: ${r.label}`,
      detail: `${r.project.name} · ${r.project.client.name} · ${formatCents(r.amountCents, r.project.currency)}`,
      href: `/projects/${r.project.id}?tab=billing`,
    })),
  ];

  const stats = {
    outstanding: sumByCurrency(open.map((i) => ({ currency: i.currency, cents: balanceCents(i) }))),
    overdue: sumByCurrency(overdue.map((i) => ({ currency: i.currency, cents: balanceCents(i) }))),
    overdueCount: overdue.length,
    billedThisMonth: sumByCurrency(thisMonth.map((r) => ({ currency: r.currency, cents: r._sum.totalCents ?? 0 }))),
    billedLastMonth: sumByCurrency(lastMonth.map((r) => ({ currency: r.currency, cents: r._sum.totalCents ?? 0 }))),
    unreadMessages,
    unreadClients,
  };
  return { stats, attention: sortAttention(attention) };
}
