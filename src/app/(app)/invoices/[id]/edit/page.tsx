import { redirect } from "next/navigation";
import { DocForm } from "@/components/billing/doc-form";
import { centsToDollarsInput } from "@/lib/money";
import { formatQuantity } from "@/lib/billing";
import { requireActor } from "@/server/authz/session";
import { getInvoice } from "@/server/services/invoices";
import { listBillingOptions } from "@/server/services/billing-options";
import { updateInvoiceAction } from "../../actions";

export const metadata = { title: "Edit invoice" };
export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(["ADMIN"]);
  const inv = await getInvoice(actor, id);
  if (inv.status !== "DRAFT") redirect(`/invoices/${id}`);
  const { clients, projects } = await listBillingOptions(actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit draft invoice</h1>
      <DocForm
        kind="invoice"
        clients={clients}
        projects={projects}
        action={updateInvoiceAction.bind(null, id)}
        lockClient
        defaults={{
          clientId: inv.clientId,
          projectId: inv.projectId ?? "",
          dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? "",
          notes: inv.notes ?? "",
          terms: inv.terms ?? "",
        }}
        initialLines={inv.lines.map((l) => ({
          description: l.description,
          quantity: formatQuantity(l.quantityMilli),
          unitPrice: centsToDollarsInput(l.unitPriceCents),
          taxable: l.taxable,
        }))}
        submitLabel="Save draft"
        cancelHref={`/invoices/${id}`}
      />
    </div>
  );
}
