import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/authz/session";
import { can } from "@/server/authz/clients";
import { listPipeline } from "@/server/services/clients";
import { setStatusAction } from "../actions";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

const COLS = [
  ["LEAD", "Leads"],
  ["ACTIVE", "Active"],
  ["PAST", "Past"],
] as const;

export default async function PipelinePage() {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const data = await listPipeline(actor);
  const canWrite = can(actor.role, "client:write");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <Link href="/clients" className="text-muted-foreground text-sm underline">
          Back to list
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {COLS.map(([key, label]) => (
          <section key={key} aria-label={label} className="bg-muted/30 rounded-md border p-3">
            <h2 className="mb-3 font-medium">
              {label} <span className="text-muted-foreground text-sm">({data[key].length})</span>
            </h2>
            <ul className="space-y-2">
              {data[key].length === 0 && <li className="text-muted-foreground text-sm">None</li>}
              {data[key].map((c) => (
                <li key={c.id} className="bg-background rounded-md border p-2">
                  <Link href={`/clients/${c.id}`} className="text-sm font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.industry && <div className="text-muted-foreground text-xs">{c.industry}</div>}
                  {canWrite && (
                    <form action={setStatusAction.bind(null, c.id)} className="mt-2 flex gap-1">
                      <select
                        name="status"
                        aria-label={`Move ${c.name}`}
                        defaultValue={c.status}
                        className="border-input bg-background h-8 flex-1 rounded-md border px-2 text-xs"
                      >
                        <option value="LEAD">Lead</option>
                        <option value="ACTIVE">Active</option>
                        <option value="PAST">Past</option>
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
        ))}
      </div>
    </div>
  );
}
