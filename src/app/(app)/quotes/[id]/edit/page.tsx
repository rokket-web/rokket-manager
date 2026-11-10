import { redirect } from "next/navigation";
import { DocForm } from "@/components/billing/doc-form";
import { centsToDollarsInput } from "@/lib/money";
import { formatQuantity } from "@/lib/billing";
import { requireActor } from "@/server/authz/session";
import { getQuote } from "@/server/services/quotes";
import { listBillingOptions } from "@/server/services/billing-options";
import { updateQuoteAction } from "../../actions";

export const metadata = { title: "Edit quote" };
export const dynamic = "force-dynamic";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(["ADMIN"]);
  const q = await getQuote(actor, id);
  if (q.status !== "DRAFT") redirect(`/quotes/${id}`);
  const { clients, projects } = await listBillingOptions(actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit draft quote</h1>
      <DocForm
        kind="quote"
        clients={clients}
        projects={projects}
        action={updateQuoteAction.bind(null, id)}
        lockClient
        defaults={{
          clientId: q.clientId,
          projectId: q.projectId ?? "",
          title: q.title ?? "",
          validUntil: q.validUntil?.toISOString().slice(0, 10) ?? "",
          notes: q.notes ?? "",
          terms: q.terms ?? "",
        }}
        initialLines={q.lines.map((l) => ({
          description: l.description,
          quantity: formatQuantity(l.quantityMilli),
          unitPrice: centsToDollarsInput(l.unitPriceCents),
          taxable: l.taxable,
        }))}
        submitLabel="Save draft"
        cancelHref={`/quotes/${id}`}
      />
    </div>
  );
}
