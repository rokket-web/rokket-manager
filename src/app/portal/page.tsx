import { requireActor } from "@/server/authz/session";

export const metadata = { title: "Client Portal" };

export default async function PortalHome() {
  const actor = await requireActor(["CLIENT"]);
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Client Portal</h1>
      <p className="text-muted-foreground">Welcome, {actor.name}. Projects and invoices appear here in later phases.</p>
    </div>
  );
}
