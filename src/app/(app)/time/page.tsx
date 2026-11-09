import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldForm } from "@/components/forms/field-form";
import { requireActor } from "@/server/authz/session";
import { canProject } from "@/server/authz/projects";
import { listAssignableProjects } from "@/server/services/projects";
import { getRunningTimer, listTimeEntries } from "@/server/services/time";
import { amountForMinutes, formatCents, formatMinutes } from "@/lib/money";
import { addManualTimeAction, deleteTimeAction, startTimerAction, stopTimerAction } from "../projects/actions";
import { fmtDate } from "../projects/status-badges";
import { Elapsed } from "./elapsed";

export const metadata = { title: "Time" };
export const dynamic = "force-dynamic";

export default async function TimePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const sp = await searchParams;
  const [running, projects, entries] = await Promise.all([
    getRunningTimer(actor),
    listAssignableProjects(actor),
    listTimeEntries(actor, { page: Number(sp.page) || 1 }),
  ]);
  const showMoney = canProject(actor.role, "money:read");
  const options = [
    { value: "", label: "Select a project..." },
    ...projects.map((p) => ({ value: p.id, label: `${p.name} (${p.client.name})` })),
  ];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Time</h1>

      <section aria-label="Timer" className="max-w-2xl rounded-md border p-4">
        {running ? (
          <div className="flex flex-wrap items-center gap-4">
            <Elapsed since={running.startedAt.toISOString()} />
            <div className="text-sm">
              <div className="font-medium">{running.project.name}</div>
              <div className="text-muted-foreground">
                {running.task?.title ?? running.description ?? "No description"}
              </div>
            </div>
            <form action={stopTimerAction} className="ml-auto">
              <Button type="submit">Stop timer</Button>
            </form>
          </div>
        ) : projects.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {actor.role === "STAFF"
              ? "You are not assigned to any projects yet."
              : "Create a project to start tracking time."}
          </p>
        ) : (
          <FieldForm
            fields={[
              { name: "projectId", label: "Project", type: "select", required: true, options },
              { name: "description", label: "What are you working on?" },
              { name: "billable", label: "Billable", type: "checkbox" },
            ]}
            action={startTimerAction}
            defaults={{ billable: "on" }}
            submitLabel="Start timer"
          />
        )}
      </section>

      {projects.length > 0 && (
        <details className="max-w-2xl rounded-md border p-4">
          <summary className="cursor-pointer font-medium">Add a manual entry</summary>
          <div className="mt-3">
            <FieldForm
              fields={[
                { name: "projectId", label: "Project", type: "select", required: true, options },
                { name: "date", label: "Date", type: "date", required: true },
                { name: "hours", label: "Hours", type: "number", min: 0, max: 24 },
                { name: "minutes", label: "Minutes", type: "number", min: 0, max: 59 },
                { name: "description", label: "Description", wide: true },
                { name: "billable", label: "Billable", type: "checkbox" },
              ]}
              action={addManualTimeAction}
              defaults={{ date: today, hours: "0", minutes: "0", billable: "on" }}
              submitLabel="Add entry"
            />
          </div>
        </details>
      )}

      <section aria-label="Entries" className="space-y-2">
        <h2 className="font-medium">{actor.role === "ADMIN" ? "All entries" : "My entries"}</h2>
        {entries.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No time entries yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2">Date</th>
                  {actor.role === "ADMIN" && <th className="p-2">Who</th>}
                  <th className="p-2">Project</th>
                  <th className="p-2">Details</th>
                  <th className="p-2">Time</th>
                  <th className="p-2">Billable</th>
                  {showMoney && <th className="p-2">Value</th>}
                  <th className="p-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.items.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="p-2">{fmtDate(e.startedAt)}</td>
                    {actor.role === "ADMIN" && <td className="p-2">{e.user.name}</td>}
                    <td className="p-2">
                      <Link href={`/projects/${e.project.id}`} className="hover:underline">
                        {e.project.name}
                      </Link>
                    </td>
                    <td className="p-2">{e.task?.title ?? e.description ?? "-"}</td>
                    <td className="p-2">{formatMinutes(e.minutes)}</td>
                    <td className="p-2">{e.billable ? "yes" : "no"}</td>
                    {showMoney && (
                      <td className="p-2">
                        {e.billable ? formatCents(amountForMinutes(e.minutes, e.rateCents)) : "-"}
                      </td>
                    )}
                    <td className="p-2">
                      {(actor.role === "ADMIN" || e.userId === actor.id) && (
                        <form action={deleteTimeAction.bind(null, e.id)}>
                          <Button type="submit" variant="ghost" size="sm">
                            Delete
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {entries.total} entries · page {entries.page} of {entries.pageCount}
          </span>
          <div className="flex gap-2">
            {entries.page > 1 && (
              <Link
                href={`/time?page=${entries.page - 1}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Previous
              </Link>
            )}
            {entries.page < entries.pageCount && (
              <Link
                href={`/time?page=${entries.page + 1}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
