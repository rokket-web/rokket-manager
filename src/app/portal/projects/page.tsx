import Link from "next/link";
import { ProjectStatusBadge } from "@/app/(app)/projects/status-badges";
import { fmtDateUtc } from "@/lib/format";
import { requireActor } from "@/server/authz/session";
import { listPortalProjects } from "@/server/services/portal";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function PortalProjects() {
  const actor = await requireActor(["CLIENT"]);
  const items = await listPortalProjects(actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Projects</h1>
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">No projects have been shared with you yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((p) => (
            <Link key={p.id} href={`/portal/projects/${p.id}`} className="hover:bg-accent/40 space-y-2 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <ProjectStatusBadge status={p.status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {p.dueDate ? `Due ${fmtDateUtc(p.dueDate)}` : "No due date"}
                {p.progressPercent !== null && ` · ${p.progressPercent}% of shared items done`}
              </p>
              {p.progressPercent !== null && (
                <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                  <div className="bg-primary h-full" style={{ width: `${p.progressPercent}%` }} />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
