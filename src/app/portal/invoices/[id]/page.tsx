import { orNotFound } from "@/lib/not-found";
import { BillingStatusBadge } from "@/components/billing/badges";
import { AutoRefresh } from "@/components/billing/auto-refresh";
import { LinesTable } from "@/components/billing/doc-view";
import { Button, buttonVariants } from "@/components/ui/button";
import { balanceCents, displayInvoiceStatus } from "@/lib/billing";
import { fmtDateUtc } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { requireActor } from "@/server/authz/session";
import { getPortalInvoice, refreshPortalInvoicePayments, utcToday } from "@/server/services/portal";
import { stripeConfigured } from "@/server/stripe";
import { payInvoiceAction } from "../../actions";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function PortalInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; paid?: string; cancelled?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(["CLIENT"]);
  await orNotFound(refreshPortalInvoicePayments(actor, id)); // confirm any payment in flight with Stripe first
  const inv = await orNotFound(getPortalInvoice(actor, id));
  const balance = balanceCents(inv);
  const payable =
    (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") && balance > 0 && inv.currency === "USD" && stripeConfigured() && !inv.processing;
  const confirming = !!sp.paid && inv.status !== "PAID" && !inv.processing;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Invoice {inv.number}</h1>
          <BillingStatusBadge status={displayInvoiceStatus(inv, utcToday())} />
        </div>
        <p className="text-muted-foreground text-sm">
          Issued {fmtDateUtc(inv.issueDate)} · Due {fmtDateUtc(inv.dueDate)}
        </p>
      </div>

      {sp.paid && inv.status === "PAID" && (
        <p role="status" className="bg-tint-green max-w-2xl rounded-xl p-3 text-sm">
          <span className="font-medium">Payment received. Thank you!</span> This invoice is paid in full.
        </p>
      )}
      {inv.processing && (
        <p role="status" className="bg-tint-amber max-w-2xl rounded-xl p-3 text-sm">
          <span className="font-medium">Payment pending.</span> Your payment of {formatCents(inv.processingCents, inv.currency)} is being processed.
          Bank payments can take a few days. This page updates when it clears, and you don&apos;t need to do anything else.
        </p>
      )}
      {confirming && (
        <p role="status" className="bg-tint-amber max-w-2xl rounded-xl p-3 text-sm">
          <span className="font-medium">Payment pending.</span> We&apos;re confirming your payment. This page updates on its own.
        </p>
      )}
      <AutoRefresh active={confirming || inv.processing} />
      {sp.cancelled && <p role="status" className="text-sm">Payment was not completed. You have not been charged.</p>}
      {sp.error && (
        <p role="alert" className="text-destructive text-sm">
          {sp.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {payable && (
          <form action={payInvoiceAction.bind(null, id)}>
            <Button type="submit">Pay {formatCents(balance, inv.currency)}</Button>
          </form>
        )}
        <a href={`/api/portal/invoices/${id}/pdf`} className={buttonVariants({ variant: "outline" })}>
          Download PDF
        </a>
      </div>

      <LinesTable
        lines={inv.lines}
        currency={inv.currency}
        subtotalCents={inv.subtotalCents}
        taxCents={inv.taxCents}
        totalCents={inv.totalCents}
        taxRateBps={inv.taxRateBps}
        paidCents={inv.paidCents}
      />

      {(inv.notes || inv.terms) && (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          {inv.notes && (
            <div>
              <h2 className="mb-1 font-medium">Notes</h2>
              <p className="whitespace-pre-wrap">{inv.notes}</p>
            </div>
          )}
          {inv.terms && (
            <div>
              <h2 className="mb-1 font-medium">Terms</h2>
              <p className="whitespace-pre-wrap">{inv.terms}</p>
            </div>
          )}
        </div>
      )}

      {inv.payments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id} className="border-t first:border-t-0">
                    <td className="p-2">{fmtDateUtc(p.date)}</td>
                    <td className="p-2">{p.refund ? "Refund" : p.method === "STRIPE" ? "Card / bank transfer" : "Payment received"}</td>
                    <td className="p-2 text-right tabular-nums">{formatCents(p.amountCents, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
