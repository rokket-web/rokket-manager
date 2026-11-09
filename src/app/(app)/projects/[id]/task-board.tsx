import Link from "next/link";
import { Button } from "@/components/ui/button";
import { setTaskStatusAction } from "../actions";
import { PriorityBadge, fmtDate } from "../status-badges";

type T = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  assignee: { name: string } | null;
};
const COLS = [
  ["TODO", "To do"],
  ["IN_PROGRESS", "In progress"],
  ["REVIEW", "Review"],
  ["DONE", "Done"],
] as const;

export function TaskBoard({ projectId, tasks, canWrite }: { projectId: string; tasks: T[]; canWrite: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {COLS.map(([key, label]) => {
        const items = tasks.filter((t) => t.status === key);
        return (
          <section key={key} aria-label={label} className="bg-muted/30 rounded-md border p-3">
            <h3 className="mb-2 text-sm font-medium">
              {label} <span className="text-muted-foreground">({items.length})</span>
            </h3>
            <ul className="space-y-2">
              {items.length === 0 && <li className="text-muted-foreground text-xs">None</li>}
              {items.map((t) => (
                <li key={t.id} className="bg-background rounded-md border p-2 text-sm">
                  <Link href={`/projects/${projectId}/tasks/${t.id}`} className="font-medium hover:underline">
                    {t.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <PriorityBadge priority={t.priority} />
                    <span className="text-muted-foreground text-xs">
                      {t.assignee?.name ?? "Unassigned"}
                      {t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ""}
                    </span>
                  </div>
                  {canWrite && (
                    <form action={setTaskStatusAction.bind(null, projectId, t.id)} className="mt-2 flex gap-1">
                      <select
                        name="status"
                        aria-label={`Move ${t.title}`}
                        defaultValue={t.status}
                        className="border-input bg-background h-8 flex-1 rounded-md border px-2 text-xs"
                      >
                        {COLS.map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm" variant="secondary">
                        Move
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
