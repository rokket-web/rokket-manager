import { requireActor } from "@/server/authz/session";
import { getClient } from "@/server/services/clients";
import { bpsToPercent } from "@/lib/tax";
import { updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";

export const metadata = { title: "Edit client" };
export const dynamic = "force-dynamic";

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(["ADMIN"]);
  const { id } = await params;
  const c = await getClient(actor, id);
  const defaults: Record<string, string> = {
    name: c.name,
    status: c.status,
    website: c.website ?? "",
    industry: c.industry ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    addressLine1: c.addressLine1 ?? "",
    addressLine2: c.addressLine2 ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    postalCode: c.postalCode ?? "",
    country: c.country ?? "",
    billingEmail: c.billingEmail ?? "",
    taxRate: c.taxRateBps == null ? "" : bpsToPercent(c.taxRateBps),
    tags: c.tagNames.join(", "),
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit {c.name}</h1>
      <ClientForm
        action={updateClientAction.bind(null, id)}
        defaults={defaults}
        submitLabel="Save changes"
        cancelHref={`/clients/${id}`}
      />
    </div>
  );
}
