import { FieldForm } from "@/components/forms/field-form";
import { requireActor } from "@/server/authz/session";
import { listClientOptions } from "@/server/services/clients";
import { createProjectAction } from "../actions";
import { projectFields } from "../project-fields";

export const metadata = { title: "New project" };
export const dynamic = "force-dynamic";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const actor = await requireActor(["ADMIN"]);
  const { clientId } = await searchParams;
  const clients = await listClientOptions(actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New project</h1>
      <FieldForm
        fields={projectFields(clients)}
        action={createProjectAction}
        defaults={{ status: "PLANNING", clientId: clientId ?? "" }}
        submitLabel="Create project"
        cancelHref="/projects"
        className="max-w-2xl"
      />
    </div>
  );
}
