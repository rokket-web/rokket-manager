import Link from "next/link";
import { BillingStatusBadge } from "@/components/billing/badges";
import { fmtDateUtc } from "@/lib/format";
import { isOverdue } from "@/lib/billing";
import { formatCents } from "@/lib/money";
import { requireActor } from "@/server/authz/session";
import { listPortalInvoices, utcToday } from "@/server/services/portal";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

export default async function PortalInvoices() {
  const actor = await requireActor(["CLIENT"]);
  const items = await listPortalInvoices(actor);
  const today = utcToday();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Invoices</h1>
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">Invoice</th>
                <th className="p-2">Status</th>
                <th className="p-2">Issued</th>
                <th className="p-2">Due</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="p-2">
                    <Link href={`/portal/invoices/${i.id}`} className="font-medium hover:underline">
                      {i.number}
                    </Link>
                  </td>
                  <td className="p-2">
                    <BillingStatusBadge status={isOverdue(i, today) ? "OVERDUE" : i.status} />
                  </td>
                  <td className="p-2">{fmtDateUtc(i.issueDate)}</td>
                  <td className="p-2">{fmtDateUtc(i.dueDate)}</td>
                  <td className="p-2 text-right tabular-nums">{formatCents(i.totalCents, i.currency)}</td>
                  <td className="p-2 text-right tabular-nums">{formatCents(Math.max(0, i.totalCents - i.paidCents), i.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
