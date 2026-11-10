import { orNotFound } from "@/lib/not-found";
import { ProjectStatusBadge } from "@/app/(app)/projects/status-badges";
import { fmtDateUtc } from "@/lib/format";
import { requireActor } from "@/server/authz/session";
import { getPortalProject } from "@/server/services/portal";

export const metadata = { title: "Project" };
export const dynamic = "force-dynamic";

const TASK: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", REVIEW: "In review", DONE: "Done" };
const MILESTONE: Record<string, string> = { PENDING: "Upcoming", IN_PROGRESS: "In progress", COMPLETED: "Completed" };

export default async function PortalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(["CLIENT"]);
  const p = await orNotFound(getPortalProject(actor, id));
  const byMilestone = (mid: string | null) => p.tasks.filter((t) => t.milestoneId === mid);
  const taskList = (tasks: typeof p.tasks) => (
    <ul className="divide-y rounded-md border text-sm">
      {tasks.map((t) => (
        <li key={t.id} className="space-y-0.5 p-2">
          <div className="flex items-center gap-2">
            <span className={t.status === "DONE" ? "text-muted-foreground flex-1 line-through" : "flex-1"}>{t.title}</span>
            <span className="text-muted-foreground text-xs">{TASK[t.status] ?? t.status}</span>
            {t.dueDate && <span className="text-muted-foreground text-xs">Due {fmtDateUtc(t.dueDate)}</span>}
          </div>
          {t.description && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{t.description}</p>}
        </li>
      ))}
    </ul>
  );
  const unassigned = byMilestone(null);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <ProjectStatusBadge status={p.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {p.startDate ? `Started ${fmtDateUtc(p.startDate)}` : "No start date"} · {p.dueDate ? `Due ${fmtDateUtc(p.dueDate)}` : "No due date"}
        </p>
        {p.description && <p className="max-w-3xl text-sm whitespace-pre-wrap">{p.description}</p>}
        {p.progressPercent !== null && (
          <div className="max-w-md space-y-1">
            <p className="text-muted-foreground text-xs">{p.progressPercent}% of shared items done</p>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
              <div className="bg-primary h-full" style={{ width: `${p.progressPercent}%` }} />
            </div>
          </div>
        )}
      </div>

      {p.milestones.length === 0 && p.tasks.length === 0 && (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">No milestones or tasks have been shared yet.</p>
      )}

      {p.milestones.map((m) => (
        <section key={m.id} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-medium">{m.title}</h2>
            <span className="text-muted-foreground text-xs">{MILESTONE[m.status] ?? m.status}</span>
            {m.dueDate && <span className="text-muted-foreground text-xs">Due {fmtDateUtc(m.dueDate)}</span>}
          </div>
          {m.description && <p className="text-muted-foreground text-sm whitespace-pre-wrap">{m.description}</p>}
          {byMilestone(m.id).length > 0 && taskList(byMilestone(m.id))}
        </section>
      ))}

      {unassigned.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">{p.milestones.length > 0 ? "Other tasks" : "Tasks"}</h2>
          {taskList(unassigned)}
        </section>
      )}
    </div>
  );
}
