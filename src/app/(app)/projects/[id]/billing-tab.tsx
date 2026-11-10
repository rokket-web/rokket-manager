import Link from "next/link";
import { BillingStatusBadge } from "@/components/billing/badges";
import { ConfirmButton } from "@/components/billing/confirm-button";
import { Button } from "@/components/ui/button";
import { centsToDollarsInput, formatCents } from "@/lib/money";
import { bpsToPercent } from "@/lib/tax";
import type { ActorLike } from "@/server/authz/clients";
import { getBillingPlan } from "@/server/services/installments";
import {
  clearPlanAction,
  createStandardBillingAction,
  invoiceInstallmentAction,
  savePlanAction,
} from "../billing-actions";
import { PlanEditor } from "./plan-editor";

export async function BillingTab({
  projectId,
  actor,
  notice,
  error,
}: {
  projectId: string;
  actor: ActorLike;
  notice?: string;
  error?: string;
}) {
  const plan = await getBillingPlan(actor, projectId);
  const fee = plan.flatFeeCents ?? 0;
  const items = plan.installments;
  const locked = items.filter((i) => i.invoice);
  const open = items.filter((i) => !i.invoice);
  return (
    <div className="max-w-3xl space-y-6">
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

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Flat fee</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatCents(fee, plan.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Invoiced</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatCents(plan.invoicedCents, plan.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatCents(plan.paidCents, plan.currency)}</dd>
        </div>
      </dl>

      {items.length === 0 ? (
        <section className="space-y-3 rounded-md border p-4">
          <p className="text-sm">
            No billing plan yet. The standard plan bills the flat fee in three invoices: <strong>40%</strong>,{" "}
            <strong>40%</strong> and <strong>20%</strong>. You can change the percentages or the number of invoices
            afterwards.
          </p>
          <form action={createStandardBillingAction.bind(null, projectId)}>
            <Button type="submit">Create standard billing</Button>
          </form>
        </section>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2">Installment</th>
                  <th className="p-2 text-right">Share</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Invoice</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="p-2">{i.label}</td>
                    <td className="p-2 text-right tabular-nums">{bpsToPercent(i.basisPoints)}%</td>
                    <td className="p-2 text-right tabular-nums">{formatCents(i.amountCents, plan.currency)}</td>
                    <td className="p-2">
                      {i.invoice ? (
                        <span className="flex items-center gap-2">
                          <Link href={`/invoices/${i.invoice.id}`} className="hover:underline">
                            {i.invoice.number ?? "Draft"}
                          </Link>
                          <BillingStatusBadge status={i.invoice.status} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not invoiced</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {!i.invoice && (
                        <form action={invoiceInstallmentAction.bind(null, projectId, i.id)}>
                          <Button type="submit" size="sm" variant="outline" aria-label={`Create invoice for ${i.label}`}>
                            Create invoice
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="space-y-2">
            <h2 className="font-medium">Adjust the plan</h2>
            <p className="text-muted-foreground text-xs">
              Change labels and percentages, or add and remove installments, as long as the total is 100%.
              {locked.length > 0 && " Installments that are already invoiced are locked and count toward the total."}
            </p>
            <PlanEditor
              action={savePlanAction.bind(null, projectId)}
              feeCents={fee}
              currency={plan.currency}
              locked={locked.map((l) => ({ label: l.label, basisPoints: l.basisPoints, amountCents: l.amountCents }))}
              initial={open.map((o) => ({ id: o.id, label: o.label, percent: bpsToPercent(o.basisPoints) }))}
            />
          </section>

          {locked.length === 0 && (
            <ConfirmButton
              action={clearPlanAction.bind(null, projectId)}
              label="Remove plan"
              prompt="Remove this billing plan?"
              confirmLabel="Yes, remove"
              destructive
            />
          )}
        </>
      )}
      <p className="text-muted-foreground text-xs">
        Each invoice is created as a draft you can review before sending. Tax is added at the client&apos;s rate. Fee: {centsToDollarsInput(fee)}.
      </p>
    </div>
  );
}
