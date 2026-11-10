import { DocForm } from "@/components/billing/doc-form";
import { requireActor } from "@/server/authz/session";
import { listBillingOptions } from "@/server/services/billing-options";
import { createInvoiceAction } from "../actions";

export const metadata = { title: "New invoice" };
export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const actor = await requireActor(["ADMIN"]);
  const { clientId } = await searchParams;
  const { clients, projects } = await listBillingOptions(actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New invoice</h1>
      <DocForm
        kind="invoice"
        clients={clients}
        projects={projects}
        action={createInvoiceAction}
        defaults={{ clientId: clientId ?? "" }}
        submitLabel="Save draft"
        cancelHref="/invoices"
      />
    </div>
  );
}
