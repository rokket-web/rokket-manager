import Link from "next/link";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, Panel, StatCard, moneyText, trend } from "@/components/dashboard/widgets";
import { plural } from "@/lib/dashboard";
import { formatMinutes } from "@/lib/money";
import { requireActor } from "@/server/authz/session";
import { getDashboard } from "@/server/services/dashboard";
import { Elapsed } from "../time/elapsed";
import { PriorityBadge, ProjectStatusBadge, fmtDate } from "../projects/status-badges";
import { stopDashboardTimerAction } from "./actions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const SEVERITY_DOT = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-sky-500" } as const;
const when = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function DashboardPage() {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const d = await getDashboard(actor);
  const m = d.money;
  const firstName = actor.name.trim().split(/\s+/)[0];

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold">Welcome back, {firstName}</h1>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {m ? (
          <>
            <StatCard label="Outstanding" value={moneyText(m.outstanding)} tint="amber" href="/invoices">
              {m.overdueCount > 0 ? (
                <span className="font-medium text-rose-600 dark:text-rose-300">
                  {moneyText(m.overdue)} overdue ({m.overdueCount})
                </span>
              ) : (
                "Nothing overdue"
              )}
            </StatCard>
            <StatCard label="Billed this month" value={moneyText(m.billedThisMonth)} tint="green" href="/invoices">
              {trend(m.billedThisMonth, m.billedLastMonth) ?? "No invoices last month to compare"}
            </StatCard>
          </>
        ) : (
          <>
            <StatCard label="Open tasks" value={String(d.openTasks)} tint="amber" />
            <StatCard label="Overdue tasks" value={String(d.overdueTasks)} tint="pink" />
          </>
        )}
        <StatCard label="Hours this week" value={formatMinutes(d.hoursWeekMinutes)} tint="blue" href="/time">
          {d.timer ? "Timer running" : "Since Monday"}
        </StatCard>
        {m ? (
          <StatCard label="Unread messages" value={String(m.unreadMessages)} tint="violet">
            {m.unreadClients.length === 0 ? (
              "All caught up"
            ) : (
              <>
                {m.unreadClients.slice(0, 2).map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <Link href={`/clients/${c.id}?tab=messages`} className="underline">
                      {c.name}
                    </Link>
                  </span>
                ))}
                {m.unreadClients.length > 2 && ` +${m.unreadClients.length - 2} more`}
              </>
            )}
          </StatCard>
        ) : (
          <StatCard label="Active projects" value={String(d.projects.length)} tint="violet" href="/projects">
            Assigned to you
          </StatCard>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-8">
          {d.isAdmin && (
            <Panel title="Needs attention">
              {d.attention.length === 0 ? (
                <Empty>All clear. Nothing overdue, unanswered or waiting on you.</Empty>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {d.attention.slice(0, 8).map((a) => (
                    <li key={a.id}>
                      <Link href={a.href} className="hover:bg-accent/40 flex items-start gap-3 p-3">
                        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[a.severity])} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{a.title}</span>
                          <span className="text-muted-foreground block truncate text-xs">{a.detail}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {d.attention.length > 8 && (
                <p className="text-muted-foreground text-xs">+{d.attention.length - 8} more not shown</p>
              )}
            </Panel>
          )}

          <Panel title="Active projects" action={{ href: "/projects", label: "All projects" }}>
            {d.projects.length === 0 ? (
              <Empty>No active projects.</Empty>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {d.projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="bg-card hover:bg-accent/40 block space-y-2 rounded-xl border p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="text-muted-foreground truncate text-xs">{p.clientName}</p>
                        </div>
                        <ProjectStatusBadge status={p.status} />
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${p.name} progress`}
                        aria-valuenow={p.progress ?? 0}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="bg-muted h-1.5 overflow-hidden rounded-full"
                      >
                        <div className="bg-primary h-full rounded-full" style={{ width: `${p.progress ?? 0}%` }} />
                      </div>
                      <p className="text-muted-foreground flex justify-between text-xs">
                        <span>{p.progress === null ? "No tasks yet" : `${p.progress}% done`}</span>
                        <span className={cn(p.overdue && "font-medium text-rose-600 dark:text-rose-300")}>
                          {p.dueDate ? `${p.overdue ? "Was due" : "Due"} ${fmtDate(p.dueDate)}` : "No due date"}
                        </span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="My tasks" action={{ href: "/projects", label: `${plural(d.openTasks, "open task")}` }}>
            {d.tasks.length === 0 ? (
              <Empty>Nothing overdue or due in the next 7 days.</Empty>
            ) : (
              <ul className="divide-y rounded-xl border">
                {d.tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="hover:bg-accent/40 flex items-center gap-3 p-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">{t.projectName}</span>
                      </span>
                      <PriorityBadge priority={t.priority} />
                      <span className={cn("w-28 shrink-0 text-right text-xs", t.overdue ? "font-medium text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>
                        {t.overdue ? "Overdue " : "Due "}
                        {fmtDate(t.dueDate)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-8">
          <Panel title="Timer">
            {d.timer ? (
              <div className="bg-tint-blue space-y-3 rounded-xl p-4">
                <Elapsed since={d.timer.startedAt.toISOString()} />
                <p className="text-sm">
                  <Link href={`/projects/${d.timer.project.id}`} className="font-medium hover:underline">
                    {d.timer.project.name}
                  </Link>
                  {d.timer.task && <span className="text-muted-foreground"> · {d.timer.task.title}</span>}
                </p>
                <form action={stopDashboardTimerAction}>
                  <Button type="submit" size="sm">
                    Stop timer
                  </Button>
                </form>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border border-dashed p-4">
                <p className="text-muted-foreground text-sm">No timer running.</p>
                <Link href="/time" className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Start a timer
                </Link>
              </div>
            )}
          </Panel>

          <Panel title="Recent activity">
            {d.activity.length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <ol className="space-y-3">
                {d.activity.map((a) => (
                  <li key={a.id} className="border-l-2 pl-3 text-sm">
                    <p>{a.summary}</p>
                    <p className="text-muted-foreground text-xs">
                      <Link href={`/clients/${a.clientId}`} className="hover:underline">
                        {a.clientName}
                      </Link>{" "}
                      · {a.actorName} · {when(a.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
