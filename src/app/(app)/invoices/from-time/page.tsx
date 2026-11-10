import { FieldForm } from "@/components/forms/field-form";
import { requireActor } from "@/server/authz/session";
import { listBillingOptions } from "@/server/services/billing-options";
import { createFromTimeAction } from "../actions";

export const metadata = { title: "Invoice from time" };
export const dynamic = "force-dynamic";

export default async function FromTimePage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const actor = await requireActor(["ADMIN"]);
  const { projectId } = await searchParams;
  const { projects } = await listBillingOptions(actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Invoice from time</h1>
      <p className="text-muted-foreground max-w-2xl text-sm">
        Creates a draft invoice from a project&apos;s finished, billable, not-yet-invoiced time entries, at the rate
        recorded on each entry. You can review and edit the draft before sending.
      </p>
      <FieldForm
        fields={[
          {
            name: "projectId",
            label: "Project",
            type: "select",
            required: true,
            options: [{ value: "", label: "Select a project..." }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
          },
          { name: "from", label: "From (optional)", type: "date" },
          { name: "to", label: "To (optional)", type: "date" },
        ]}
        action={createFromTimeAction}
        defaults={{ projectId: projectId ?? "" }}
        submitLabel="Create draft invoice"
        cancelHref="/invoices"
        className="max-w-2xl"
      />
    </div>
  );
}
