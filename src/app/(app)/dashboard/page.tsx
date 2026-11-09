import { requireActor } from "@/server/authz/session";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">Welcome, {actor.name}. Widgets arrive in later phases.</p>
    </div>
  );
}
