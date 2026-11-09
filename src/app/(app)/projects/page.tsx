import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireActor } from "@/server/authz/session";
import { canProject } from "@/server/authz/projects";
import { listProjects } from "@/server/services/projects";
import { formatCents } from "@/lib/money";
import { PROJECT_STATUS_OPTIONS } from "./project-fields";
import { ProjectStatusBadge, fmtDate } from "./status-badges";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const sp = await searchParams;
  const { items, total, page, pageCount, query } = await listProjects(actor, {
    q: one(sp.q),
    status: one(sp.status),
    clientId: one(sp.clientId),
    page: one(sp.page),
  });
  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: query.q, status: query.status, clientId: query.clientId, ...over }))
      if (v) p.set(k, v);
    return `/projects${p.size ? `?${p}` : ""}`;
  };
  const showMoney = canProject(actor.role, "money:read");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Projects</h1>
        {canProject(actor.role, "project:write") && (
          <Link href="/projects/new" className={buttonVariants()}>
            New project
          </Link>
        )}
      </div>
      <form method="get" className="flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <Input
          id="q"
          name="q"
          placeholder="Search projects or clients..."
          defaultValue={query.q ?? ""}
          className="min-w-48 flex-1"
        />
        <select
          name="status"
          aria-label="Status"
          defaultValue={query.status ?? ""}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">All statuses</option>
          {PROJECT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(query.q || query.status || query.clientId) && (
          <Link href="/projects" className="text-muted-foreground self-center text-sm underline">
            Clear
          </Link>
        )}
      </form>
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          {actor.role === "STAFF" ? "You are not assigned to any projects yet." : "No projects found."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">Project</th>
                <th className="p-2">Client</th>
                <th className="p-2">Status</th>
                <th className="p-2">Progress</th>
                <th className="p-2">Due</th>
                {showMoney && <th className="p-2">Budget</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="p-2">
                    <Link href={`/clients/${p.client.id}`} className="hover:underline">
                      {p.client.name}
                    </Link>
                  </td>
                  <td className="p-2">
                    <ProjectStatusBadge status={p.status} />
                  </td>
                  <td className="p-2">{p._count.tasks ? `${p.tasksDone}/${p._count.tasks} tasks` : "-"}</td>
                  <td className="p-2">{fmtDate(p.dueDate)}</td>
                  {showMoney && (
                    <td className="p-2">{p.budgetCents != null ? formatCents(p.budgetCents, p.currency) : "-"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {total} project{total === 1 ? "" : "s"} · page {page} of {pageCount}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={href({ page: String(page - 1) })}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Previous
            </Link>
          )}
          {page < pageCount && (
            <Link
              href={href({ page: String(page + 1) })}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
