import Link from "next/link";
import { BillingStatusBadge } from "@/components/billing/badges";
import { fmtDateUtc } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { requireActor } from "@/server/authz/session";
import { listPortalQuotes, utcToday } from "@/server/services/portal";

export const metadata = { title: "Quotes" };
export const dynamic = "force-dynamic";

export default async function PortalQuotes() {
  const actor = await requireActor(["CLIENT"]);
  const items = await listPortalQuotes(actor);
  const today = utcToday();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Quotes</h1>
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">No quotes yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">Quote</th>
                <th className="p-2">Title</th>
                <th className="p-2">Status</th>
                <th className="p-2">Valid until</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => {
                const expired = q.status === "SENT" && !!q.validUntil && q.validUntil < today;
                return (
                  <tr key={q.id} className="border-t">
                    <td className="p-2">
                      <Link href={`/portal/quotes/${q.id}`} className="font-medium hover:underline">
                        {q.number}
                      </Link>
                    </td>
                    <td className="p-2">{q.title ?? "-"}</td>
                    <td className="p-2">
                      <BillingStatusBadge status={expired ? "EXPIRED" : q.status} />
                    </td>
                    <td className="p-2">{fmtDateUtc(q.validUntil)}</td>
                    <td className="p-2 text-right tabular-nums">{formatCents(q.totalCents, q.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
