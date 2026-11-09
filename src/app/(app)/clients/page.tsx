import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/authz/session";
import { can } from "@/server/authz/clients";
import { listAllTags, listClients } from "@/server/services/clients";
import { StatusBadge } from "./status-badge";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const sp = await searchParams;
  const raw = { q: one(sp.q), status: one(sp.status), tag: one(sp.tag), sort: one(sp.sort), page: one(sp.page) };
  const [{ items, total, page, pageCount, query }, tags] = await Promise.all([
    listClients(actor, raw),
    listAllTags(actor),
  ]);
  const canWrite = can(actor.role, "client:write");

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      q: query.q,
      status: query.status,
      tag: query.tag,
      sort: query.sort === "name" ? undefined : query.sort,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/clients?${qs}` : "/clients";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Clients</h1>
        <Link href="/clients/pipeline" className={buttonVariants({ variant: "outline" })}>
          Pipeline
        </Link>
        {can(actor.role, "client:export") && (
          <a href="/api/clients/export" className={buttonVariants({ variant: "outline" })}>
            Export CSV
          </a>
        )}
        {can(actor.role, "client:import") && (
          <Link href="/clients/import" className={buttonVariants({ variant: "outline" })}>
            Import CSV
          </Link>
        )}
        {canWrite && (
          <Link href="/clients/new" className={buttonVariants()}>
            New client
          </Link>
        )}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="sr-only">
            Search
          </label>
          <Input id="q" name="q" placeholder="Search name, email, industry, contact..." defaultValue={query.q ?? ""} />
        </div>
        <select
          name="status"
          aria-label="Status"
          defaultValue={query.status ?? ""}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="LEAD">Lead</option>
          <option value="ACTIVE">Active</option>
          <option value="PAST">Past</option>
        </select>
        <select
          name="tag"
          aria-label="Tag"
          defaultValue={query.tag ?? ""}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          name="sort"
          aria-label="Sort"
          defaultValue={query.sort}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="name">Name</option>
          <option value="newest">Newest</option>
          <option value="status">Status</option>
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(query.q || query.status || query.tag) && (
          <Link href="/clients" className="text-muted-foreground text-sm underline">
            Clear
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          {actor.role === "STAFF" ? "No clients are assigned to you yet." : "No clients found."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">Client</th>
                <th className="p-2">Status</th>
                <th className="p-2">Primary contact</th>
                <th className="p-2">Tags</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const pc = c.contacts[0];
                return (
                  <tr key={c.id} className="border-t">
                    <td className="p-2">
                      <Link href={`/clients/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                        {c.name}
                      </Link>
                      {c.industry && <div className="text-muted-foreground text-xs">{c.industry}</div>}
                    </td>
                    <td className="p-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="p-2">
                      {pc ? (
                        <>
                          {pc.firstName} {pc.lastName}
                          {pc.email && <div className="text-muted-foreground text-xs">{pc.email}</div>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="p-2">
                      {c.tags.map((t) => (
                        <Link
                          key={t.tag.name}
                          href={href({ tag: t.tag.name, page: undefined })}
                          className="bg-muted mr-1 inline-block rounded px-1.5 py-0.5 text-xs"
                        >
                          {t.tag.name}
                        </Link>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {total} client{total === 1 ? "" : "s"} · page {page} of {pageCount}
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
