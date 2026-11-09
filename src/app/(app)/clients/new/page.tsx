import { requireActor } from "@/server/authz/session";
import { createClientAction } from "../actions";
import { ClientForm } from "../client-form";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireActor(["ADMIN"]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New client</h1>
      <ClientForm action={createClientAction} defaults={{}} submitLabel="Create client" cancelHref="/clients" />
    </div>
  );
}
