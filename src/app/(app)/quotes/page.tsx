import Link from "next/link";
import { BillingStatusBadge } from "@/components/billing/badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import { requireActor } from "@/server/authz/session";
import { listQuotes } from "@/server/services/quotes";
import { fmtDate } from "../projects/status-badges";

export const metadata = { title: "Quotes" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const STATUSES = [
  ["DRAFT", "Draft"],
  ["SENT", "Sent"],
  ["ACCEPTED", "Accepted"],
  ["DECLINED", "Declined"],
  ["CHANGES_REQUESTED", "Edits requested"],
];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor(["ADMIN"]);
  const sp = await searchParams;
  const q = { q: one(sp.q), status: one(sp.status), clientId: one(sp.clientId) };
  const { items, total, page, pageCount } = await listQuotes(actor, { ...q, page: one(sp.page) });
  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, ...over })) if (v) p.set(k, v);
    return `/quotes${p.size ? `?${p}` : ""}`;
  };
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Quotes</h1>
        <Link href="/quotes/new" className={buttonVariants()}>
          New quote
        </Link>
      </div>
      <form method="get" className="flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <Input id="q" name="q" placeholder="Search number, title or client..." defaultValue={q.q ?? ""} className="min-w-48 flex-1" />
        <select
          name="status"
          aria-label="Status"
          defaultValue={q.status ?? ""}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(q.q || q.status || q.clientId) && (
          <Link href="/quotes" className="text-muted-foreground self-center text-sm underline">
            Clear
          </Link>
        )}
      </form>
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">No quotes found.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">Number</th>
                <th className="p-2">Title</th>
                <th className="p-2">Client</th>
                <th className="p-2">Status</th>
                <th className="p-2">Valid until</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const expired = r.status === "SENT" && !!r.validUntil && r.validUntil < today;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">
                      <Link href={`/quotes/${r.id}`} className="font-medium hover:underline">
                        {r.number ?? "Draft"}
                      </Link>
                    </td>
                    <td className="p-2">{r.title ?? "-"}</td>
                    <td className="p-2">
                      <Link href={`/clients/${r.client.id}`} className="hover:underline">
                        {r.client.name}
                      </Link>
                    </td>
                    <td className="p-2">
                      <BillingStatusBadge status={expired ? "EXPIRED" : r.status} />
                    </td>
                    <td className="p-2">{fmtDate(r.validUntil)}</td>
                    <td className="p-2 text-right tabular-nums">{formatCents(r.totalCents, r.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {total} quote{total === 1 ? "" : "s"} · page {page} of {pageCount}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={href({ page: String(page - 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Previous
            </Link>
          )}
          {page < pageCount && (
            <Link href={href({ page: String(page + 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
