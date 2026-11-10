import { orNotFound } from "@/lib/not-found";
import { FieldForm } from "@/components/forms/field-form";
import { requireActor } from "@/server/authz/session";
import { getProject } from "@/server/services/projects";
import { centsToDollarsInput } from "@/lib/money";
import { updateProjectAction } from "../../actions";
import { projectFields } from "../../project-fields";

export const metadata = { title: "Edit project" };
export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(["ADMIN"]);
  const { id } = await params;
  const p = await orNotFound(getProject(actor, id));
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit {p.name}</h1>
      <p className="text-muted-foreground text-sm">Client: {p.client.name}</p>
      <FieldForm
        fields={projectFields(null)}
        action={updateProjectAction.bind(null, id)}
        defaults={{
          name: p.name,
          status: p.status,
          description: p.description ?? "",
          billingType: p.billingType,
          flatFee: p.flatFeeCents != null ? centsToDollarsInput(p.flatFeeCents) : "",
          budget: p.budgetCents != null ? centsToDollarsInput(p.budgetCents) : "",
          hourlyRate: p.hourlyRateCents != null ? centsToDollarsInput(p.hourlyRateCents) : "",
          startDate: iso(p.startDate),
          dueDate: iso(p.dueDate),
        }}
        submitLabel="Save changes"
        cancelHref={`/projects/${id}`}
        className="max-w-2xl"
      />
    </div>
  );
}
