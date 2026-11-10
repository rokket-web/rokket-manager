import { DocForm } from "@/components/billing/doc-form";
import { requireActor } from "@/server/authz/session";
import { listBillingOptions } from "@/server/services/billing-options";
import { createQuoteAction } from "../actions";

export const metadata = { title: "New quote" };
export const dynamic = "force-dynamic";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const actor = await requireActor(["ADMIN"]);
  const { clientId } = await searchParams;
  const { clients, projects } = await listBillingOptions(actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New quote</h1>
      <DocForm
        kind="quote"
        clients={clients}
        projects={projects}
        action={createQuoteAction}
        defaults={{ clientId: clientId ?? "" }}
        submitLabel="Save draft"
        cancelHref="/quotes"
      />
    </div>
  );
}
