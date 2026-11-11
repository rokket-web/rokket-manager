import Link from "next/link";
import { BillingStatusBadge } from "@/components/billing/badges";
import { AutoRefresh } from "@/components/billing/auto-refresh";
import { ConfirmButton } from "@/components/billing/confirm-button";
import { LinesTable } from "@/components/billing/doc-view";
import { FieldForm } from "@/components/forms/field-form";
import { buttonVariants } from "@/components/ui/button";
import { balanceCents, displayInvoiceStatus } from "@/lib/billing";
import { centsToDollarsInput, formatCents } from "@/lib/money";
import { RefundForm } from "@/components/billing/refund-form";
import { payUrl, stripeConfigured } from "@/server/stripe";
import { requireActor } from "@/server/authz/session";
import { getInvoice, refreshInvoicePayments } from "@/server/services/invoices";
import { fmtDate } from "../../projects/status-badges";
import { deleteInvoiceAction, recordPaymentAction, refundPaymentAction, resendInvoiceAction, sendInvoiceAction, voidInvoiceAction } from "../actions";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const actor = await requireActor(["ADMIN"]);
  await refreshInvoicePayments(actor, id); // pull the latest from Stripe so Paid / Pending is current
  const inv = await getInvoice(actor, id);
  const processing = inv.payments.filter((p) => p.status === "PROCESSING");
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const balance = balanceCents(inv);
  const canPay = inv.status === "SENT" || inv.status === "PARTIALLY_PAID";
  const hasPayments = inv.payments.some((p) => p.status === "SUCCEEDED");
  const link = canPay && stripeConfigured() && inv.currency === "USD" ? payUrl(inv.publicToken) : null;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Invoice {inv.number ?? "(draft)"}</h1>
          <BillingStatusBadge status={displayInvoiceStatus({ ...inv, processing: processing.length > 0 }, today)} />
        </div>
        <p className="text-muted-foreground text-sm">
          <Link href={`/clients/${inv.client.id}`} className="hover:underline">
            {inv.client.name}
          </Link>
          {inv.project && (
            <>
              {" · "}
              <Link href={`/projects/${inv.project.id}`} className="hover:underline">
                {inv.project.name}
              </Link>
            </>
          )}
          {inv.quote?.number && (
            <>
              {" · from quote "}
              <Link href={`/quotes/${inv.quote.id}`} className="hover:underline">
                {inv.quote.number}
              </Link>
            </>
          )}
        </p>
        <p className="text-muted-foreground text-sm">
          Issued {fmtDate(inv.issueDate)} · Due {fmtDate(inv.dueDate)}
          {inv.paidAt && ` · Paid ${fmtDate(inv.paidAt)}`}
        </p>
      </div>

      {processing.length > 0 && (
        <p role="status" className="bg-tint-amber max-w-2xl rounded-xl p-3 text-sm">
          <span className="font-medium">Payment pending.</span> {formatCents(processing.reduce((s, p) => s + p.amountCents, 0), inv.currency)} was
          submitted through Stripe and is waiting to settle. This page updates when it clears; bank payments can take a few days.
        </p>
      )}
      <AutoRefresh active={processing.length > 0} everyMs={15_000} />

      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {inv.status === "DRAFT" && (
          <>
            <Link href={`/invoices/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
              Edit
            </Link>
            <ConfirmButton
              action={sendInvoiceAction.bind(null, id)}
              label="Send invoice"
              prompt="Email the PDF to the client and lock this invoice?"
              confirmLabel="Yes, send"
            />
            <ConfirmButton
              action={deleteInvoiceAction.bind(null, id)}
              label="Delete"
              prompt="Delete this draft?"
              confirmLabel="Yes, delete"
              destructive
            />
          </>
        )}
        {inv.number && (
          <a href={`/api/invoices/${id}/pdf`} className={buttonVariants({ variant: "outline" })}>
            Download PDF
          </a>
        )}
        {canPay && (
          <ConfirmButton
            action={resendInvoiceAction.bind(null, id)}
            label="Resend email"
            prompt="Email this invoice to the client again?"
            confirmLabel="Yes, resend"
          />
        )}
        {(inv.status === "SENT" || inv.status === "PARTIALLY_PAID") && !hasPayments && (
          <ConfirmButton
            action={voidInvoiceAction.bind(null, id)}
            label="Void"
            prompt="Void this invoice? Linked time becomes billable again."
            confirmLabel="Yes, void"
            destructive
          />
        )}
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Payments</h2>
        {inv.payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Method</th>
                  <th className="p-2">Reference</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">{fmtDate(p.paidAt ?? p.createdAt)}</td>
                    <td className="p-2">{p.method === "STRIPE" ? "Card / Stripe" : "Manual"}</td>
                    <td className="p-2">{p.reference?.startsWith("refund:") ? "Refund" : (p.reference ?? "-")}</td>
                    <td className="p-2">{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</td>
                    <td className="p-2 text-right tabular-nums">{formatCents(p.amountCents, p.currency)}</td>
                    <td className="p-2">
                      {p.method === "STRIPE" && p.status === "SUCCEEDED" && p.amountCents > 0 && p.stripePaymentIntentId && (
                        <RefundForm
                          action={refundPaymentAction.bind(null, id, p.id)}
                          defaultAmount={centsToDollarsInput(p.amountCents)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {link && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Online payment link</h3>
            <input
              readOnly
              aria-label="Online payment link"
              value={link}
              className="border-input bg-muted/30 w-full max-w-2xl rounded-md border px-3 py-1.5 font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">Included in the invoice email. Opens Stripe Checkout for the balance due.</p>
          </div>
        )}
        {canPay && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Record a payment received outside Stripe (check, transfer, cash)</h3>
            <FieldForm
              fields={[
                { name: "amount", label: "Amount (USD)", required: true, hint: `Balance due ${formatCents(balance, inv.currency)}` },
                { name: "paidAt", label: "Date received", type: "date" },
                { name: "reference", label: "Reference", hint: "Check number, transfer id, etc." },
              ]}
              action={recordPaymentAction.bind(null, id)}
              defaults={{ amount: centsToDollarsInput(balance) }}
              submitLabel="Record payment"
              className="max-w-2xl"
            />
          </div>
        )}
      </section>
    </div>
  );
}
