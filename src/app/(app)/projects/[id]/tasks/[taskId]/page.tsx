import { orNotFound } from "@/lib/not-found";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldForm } from "@/components/forms/field-form";
import { requireActor } from "@/server/authz/session";
import { getProject } from "@/server/services/projects";
import { getTask } from "@/server/services/tasks";
import { addCommentAction, deleteCommentAction, deleteTaskAction, updateTaskAction } from "../../../actions";
import { taskFields } from "../../../project-fields";
import { PriorityBadge, fmtDate } from "../../../status-badges";
import { DeleteButton } from "../../delete-button";
import { CommentForm } from "./comment-form";
import { StartTimerButton } from "./start-timer-button";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: "Task" };
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function TaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const { id, taskId } = await params;
  const [project, task] = await Promise.all([orNotFound(getProject(actor, id)), orNotFound(getTask(actor, taskId))]);
  if (task.projectId !== id) notFound();
  const members = project.members.map((m) => m.user);
  const fmt = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${id}?tab=tasks`} className="text-muted-foreground text-sm hover:underline">
          ← {project.name}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{task.title}</h1>
        <PriorityBadge priority={task.priority} />
        <span className="bg-muted rounded px-1.5 py-0.5 text-xs">{task.status.replace("_", " ").toLowerCase()}</span>
        <div className="ml-auto flex items-center gap-2">
          <StartTimerButton projectId={id} taskId={taskId} />
          <DeleteButton action={deleteTaskAction.bind(null, id, taskId)} label="Delete this task?" />
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        {task.assignee ? `Assigned to ${task.assignee.name}` : "Unassigned"} · due {fmtDate(task.dueDate)}
        {task.milestone ? ` · milestone ${task.milestone.title}` : ""}
      </p>
      {task.description && <p className="text-sm whitespace-pre-wrap">{task.description}</p>}

      <details>
        <summary className="cursor-pointer text-sm underline">Edit task</summary>
        <div className="mt-3">
          <FieldForm
            fields={taskFields(members, project.milestones)}
            action={updateTaskAction.bind(null, id, taskId)}
            defaults={{
              title: task.title,
              status: task.status,
              priority: task.priority,
              assigneeId: task.assigneeId ?? "",
              milestoneId: task.milestoneId ?? "",
              dueDate: iso(task.dueDate),
              description: task.description ?? "",
            }}
            submitLabel="Save task"
          />
        </div>
      </details>

      <section className="space-y-3">
        <h2 className="font-medium">Comments</h2>
        <p className="text-muted-foreground text-xs">
          Internal only for now. Client-visible comments arrive with the portal.
        </p>
        {task.comments.length === 0 && <p className="text-muted-foreground text-sm">No comments yet.</p>}
        {task.comments.map((c) => (
          <article key={c.id} className="rounded-md border p-3">
            <p className="text-sm whitespace-pre-wrap">{c.body}</p>
            <div className="text-muted-foreground mt-2 flex items-center text-xs">
              <span>
                {c.authorId ? (task.authorNames[c.authorId] ?? "Unknown") : "System"} · {fmt(c.createdAt)}
              </span>
              {(actor.role === "ADMIN" || c.authorId === actor.id) && (
                <form action={deleteCommentAction.bind(null, id, taskId, c.id)} className="ml-auto">
                  <Button type="submit" variant="ghost" size="sm">
                    Delete
                  </Button>
                </form>
              )}
            </div>
          </article>
        ))}
        <CommentForm action={addCommentAction.bind(null, id, taskId)} />
      </section>
    </div>
  );
}
