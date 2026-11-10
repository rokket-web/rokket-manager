import { orNotFound } from "@/lib/not-found";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldForm } from "@/components/forms/field-form";
import { requireActor } from "@/server/authz/session";
import { canProject } from "@/server/authz/projects";
import { getProjectDashboard, listAssignableUsers } from "@/server/services/projects";
import { listTasks } from "@/server/services/tasks";
import { listTimeEntries } from "@/server/services/time";
import { listFiles } from "@/server/services/files";
import { amountForMinutes, centsToDollarsInput, formatCents, formatMinutes } from "@/lib/money";
import {
  createMilestoneAction,
  createTaskAction,
  deleteFileAction,
  deleteMilestoneAction,
  deleteProjectAction,
  setMembersAction,
  updateMilestoneAction,
} from "../actions";
import { milestoneFields, taskFields } from "../project-fields";
import { PriorityBadge, ProjectStatusBadge, fmtDate } from "../status-badges";
import { FileUploader } from "./file-uploader";
import { TaskBoard } from "./task-board";
import { ClientPortalTab } from "./client-portal-tab";
import { DeleteButton } from "./delete-button";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: "Project" };
}

const TABS = [
  ["overview", "Overview"],
  ["tasks", "Tasks"],
  ["milestones", "Milestones"],
  ["time", "Time"],
  ["files", "Files"],
  ["team", "Team"],
  ["portal", "Client portal"],
] as const;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const { id } = await params;
  const sp = await searchParams;
  const adminTabs = canProject(actor.role, "project:write");
  const visibleTabs = TABS.filter(([k]) => k !== "portal" || adminTabs);
  const tab = visibleTabs.find(([k]) => k === sp.tab)?.[0] ?? "overview";
  const dash = await orNotFound(getProjectDashboard(actor, id));
  const p = dash.project;
  const isAdmin = canProject(actor.role, "project:write");
  const showMoney = canProject(actor.role, "money:read");
  const members = p.members.map((m) => m.user);
  const money =
    "billableCents" in dash
      ? (dash as { billableCents: number; budgetCents: number | null; budgetUsedPercent: number | null })
      : null;
  const base = `/projects/${id}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <ProjectStatusBadge status={p.status} />
        {isAdmin && p.visibleToClient && (
          <Link href={`${base}?tab=portal`} className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
            Shared with client
          </Link>
        )}
        <Link href={`/clients/${p.client.id}`} className="text-muted-foreground text-sm hover:underline">
          {p.client.name}
        </Link>
        {isAdmin && (
          <div className="ml-auto flex items-center gap-2">
            <Link href={`/invoices/from-time?projectId=${id}`} className={buttonVariants({ variant: "outline" })}>
              Invoice time
            </Link>
            <Link href={`${base}/edit`} className={buttonVariants({ variant: "outline" })}>
              Edit
            </Link>
            <DeleteButton
              action={deleteProjectAction.bind(null, id)}
              label={`Delete project ${p.name} and all its tasks, time and files?`}
            />
          </div>
        )}
      </div>

      <nav aria-label="Project sections" className="flex gap-1 overflow-x-auto border-b">
        {visibleTabs.map(([k, label]) => (
          <Link
            key={k}
            href={`${base}?tab=${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={`px-3 py-2 text-sm whitespace-nowrap ${tab === k ? "border-primary border-b-2 font-medium" : "text-muted-foreground"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Progress"
              value={`${dash.progressPercent}%`}
              sub={`${dash.tasks.done}/${dash.tasks.total} tasks · ${dash.milestones.done}/${dash.milestones.total} milestones`}
            />
            <Stat
              label="Hours logged"
              value={formatMinutes(dash.totalMinutes)}
              sub={`${formatMinutes(dash.billableMinutes)} billable`}
            />
            {showMoney && money && (
              <Stat
                label="Billable value"
                value={formatCents(money.billableCents, p.currency)}
                sub={
                  money.budgetCents != null
                    ? `of ${formatCents(money.budgetCents, p.currency)} budget (${money.budgetUsedPercent}%)`
                    : "No budget set"
                }
              />
            )}
            <Stat
              label="Due"
              value={fmtDate(p.dueDate)}
              sub={p.startDate ? `Started ${fmtDate(p.startDate)}` : "No start date"}
            />
          </div>
          <section>
            <h2 className="mb-2 font-medium">Upcoming deadlines (next 14 days)</h2>
            {dash.deadlines.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing due soon.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {dash.deadlines.map((d) => (
                  <li key={`${d.kind}-${d.id}`} className="flex gap-2">
                    <span className={d.overdue ? "text-destructive w-28 font-medium" : "w-28"}>
                      {fmtDate(d.dueDate)}
                      {d.overdue ? " (overdue)" : ""}
                    </span>
                    <span className="text-muted-foreground w-20">{d.kind}</span>
                    {d.kind === "task" ? (
                      <Link href={`${base}/tasks/${d.id}`} className="hover:underline">
                        {d.title}
                      </Link>
                    ) : (
                      <span>{d.title}</span>
                    )}
                    {d.who && <span className="text-muted-foreground">· {d.who}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {p.description && (
            <section>
              <h2 className="mb-1 font-medium">Description</h2>
              <p className="text-sm whitespace-pre-wrap">{p.description}</p>
            </section>
          )}
        </div>
      )}

      {tab === "tasks" && (
        <TasksTab
          projectId={id}
          actorId={actor.id}
          view={sp.view === "board" ? "board" : "list"}
          mine={sp.mine === "1"}
          status={sp.status}
          members={members}
          milestones={p.milestones}
          actor={actor}
        />
      )}

      {tab === "milestones" && (
        <div className="max-w-3xl space-y-4">
          {p.milestones.length === 0 && <p className="text-muted-foreground text-sm">No milestones yet.</p>}
          {p.milestones.map((m) => (
            <div key={m.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.title}</span>
                <span className="bg-muted rounded px-1.5 py-0.5 text-xs">
                  {m.status.replace("_", " ").toLowerCase()}
                </span>
                <span className="text-muted-foreground text-sm">
                  due {fmtDate(m.dueDate)}
                  {showMoney && m.billableCents != null ? ` · ${formatCents(m.billableCents, p.currency)}` : ""}
                </span>
                {isAdmin && (
                  <div className="ml-auto">
                    <DeleteButton
                      action={deleteMilestoneAction.bind(null, id, m.id)}
                      label={`Delete milestone ${m.title}?`}
                      small
                    />
                  </div>
                )}
              </div>
              {m.description && <p className="text-muted-foreground mt-1 text-sm">{m.description}</p>}
              {isAdmin && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <div className="mt-3">
                    <FieldForm
                      fields={milestoneFields}
                      action={updateMilestoneAction.bind(null, id, m.id)}
                      defaults={{
                        title: m.title,
                        status: m.status,
                        dueDate: iso(m.dueDate),
                        billable: m.billableCents != null ? centsToDollarsInput(m.billableCents) : "",
                        description: m.description ?? "",
                      }}
                      submitLabel="Save milestone"
                    />
                  </div>
                </details>
              )}
            </div>
          ))}
          {isAdmin && (
            <section className="rounded-md border p-3">
              <h2 className="mb-3 font-medium">Add milestone</h2>
              <FieldForm
                fields={milestoneFields}
                action={createMilestoneAction.bind(null, id)}
                defaults={{ status: "PENDING" }}
                submitLabel="Add milestone"
              />
            </section>
          )}
        </div>
      )}

      {tab === "portal" && isAdmin && <ClientPortalTab projectId={id} actor={actor} />}

      {tab === "time" && <TimeTab projectId={id} actor={actor} showMoney={showMoney} />}

      {tab === "files" && <FilesTab projectId={id} clientId={p.client.id} actor={actor} />}

      {tab === "team" && (
        <div className="max-w-md space-y-3">
          {isAdmin ? (
            <TeamForm projectId={id} selected={members.map((m) => m.id)} />
          ) : (
            <ul className="text-sm">
              {members.map((m) => (
                <li key={m.id}>{m.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

async function TeamForm({ projectId, selected }: { projectId: string; selected: string[] }) {
  const actor = await requireActor(["ADMIN"]);
  const users = await listAssignableUsers(actor);
  return (
    <form action={setMembersAction.bind(null, projectId)} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="font-medium">Project team</legend>
        {users.map((u) => (
          <label key={u.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="userId" value={u.id} defaultChecked={selected.includes(u.id)} /> {u.name}{" "}
            <span className="text-muted-foreground">({u.role.toLowerCase()})</span>
          </label>
        ))}
      </fieldset>
      <Button type="submit">Save team</Button>
    </form>
  );
}

async function TasksTab({
  projectId,
  view,
  mine,
  status,
  members,
  milestones,
  actor,
}: {
  projectId: string;
  actorId: string;
  view: "list" | "board";
  mine: boolean;
  status?: string;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
  actor: Awaited<ReturnType<typeof requireActor>>;
}) {
  const tasks = await listTasks(actor, projectId, { mine, status });
  const base = `/projects/${projectId}`;
  const q = (o: Record<string, string>) =>
    `${base}?${new URLSearchParams({ tab: "tasks", ...(mine ? { mine: "1" } : {}), ...(status ? { status } : {}), view, ...o })}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={q({ view: "list" })}
          aria-current={view === "list" ? "true" : undefined}
          className={buttonVariants({ variant: view === "list" ? "secondary" : "outline", size: "sm" })}
        >
          List
        </Link>
        <Link
          href={q({ view: "board" })}
          aria-current={view === "board" ? "true" : undefined}
          className={buttonVariants({ variant: view === "board" ? "secondary" : "outline", size: "sm" })}
        >
          Board
        </Link>
        <Link
          href={mine ? `${base}?tab=tasks&view=${view}` : `${base}?tab=tasks&view=${view}&mine=1`}
          className={buttonVariants({ variant: mine ? "secondary" : "outline", size: "sm" })}
        >
          My tasks
        </Link>
      </div>
      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tasks match.</p>
      ) : view === "board" ? (
        <TaskBoard projectId={projectId} tasks={tasks} canWrite />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">Task</th>
                <th className="p-2">Status</th>
                <th className="p-2">Priority</th>
                <th className="p-2">Assignee</th>
                <th className="p-2">Due</th>
                <th className="p-2">Milestone</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">
                    <Link href={`${base}/tasks/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                    {t._count.comments > 0 && (
                      <span className="text-muted-foreground ml-2 text-xs">{t._count.comments} comments</span>
                    )}
                  </td>
                  <td className="p-2">{t.status.replace("_", " ").toLowerCase()}</td>
                  <td className="p-2">
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td className="p-2">{t.assignee?.name ?? "-"}</td>
                  <td className="p-2">{fmtDate(t.dueDate)}</td>
                  <td className="p-2">{t.milestone?.title ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="max-w-2xl rounded-md border p-3">
        <h2 className="mb-3 font-medium">Add task</h2>
        <FieldForm
          fields={taskFields(members, milestones)}
          action={createTaskAction.bind(null, projectId)}
          defaults={{ status: "TODO", priority: "MEDIUM" }}
          submitLabel="Add task"
        />
      </section>
    </div>
  );
}

async function TimeTab({
  projectId,
  actor,
  showMoney,
}: {
  projectId: string;
  actor: Awaited<ReturnType<typeof requireActor>>;
  showMoney: boolean;
}) {
  const { items, total } = await listTimeEntries(actor, { projectId, pageSize: 25 });
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Latest entries{actor.role === "STAFF" ? " (yours)" : ""} · {total} total.{" "}
        <Link href="/time" className="underline">
          Log time
        </Link>
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No time logged yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Who</th>
                <th className="p-2">Task</th>
                <th className="p-2">Time</th>
                <th className="p-2">Billable</th>
                {showMoney && <th className="p-2">Value</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2">{fmtDate(e.startedAt)}</td>
                  <td className="p-2">{e.user.name}</td>
                  <td className="p-2">{e.task?.title ?? e.description ?? "-"}</td>
                  <td className="p-2">{formatMinutes(e.minutes)}</td>
                  <td className="p-2">{e.billable ? "yes" : "no"}</td>
                  {showMoney && (
                    <td className="p-2">{e.billable ? formatCents(amountForMinutes(e.minutes, e.rateCents)) : "-"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function FilesTab({
  projectId,
  clientId,
  actor,
}: {
  projectId: string;
  clientId: string;
  actor: Awaited<ReturnType<typeof requireActor>>;
}) {
  const files = await listFiles(actor, { projectId });
  const path = `/projects/${projectId}`;
  return (
    <div className="max-w-3xl space-y-4">
      <FileUploader clientId={clientId} projectId={projectId} revalidate={path} />
      {files.length === 0 ? (
        <p className="text-muted-foreground text-sm">No files yet.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 p-2">
              <a href={`/api/files/${f.id}`} className="font-medium hover:underline">
                {f.name}
              </a>
              <span className="text-muted-foreground">
                {(f.size / 1024 / 1024).toFixed(2)} MB · {fmtDate(f.createdAt)}
              </span>
              {(actor.role === "ADMIN" || f.uploadedById === actor.id) && (
                <div className="ml-auto">
                  <DeleteButton action={deleteFileAction.bind(null, f.id, path)} label={`Delete ${f.name}?`} small />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
