import { requireActor } from "@/server/authz/session";
import { ThemeToggle } from "@/components/shell/theme-toggle";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="space-y-1">
        <h2 className="font-medium">Account</h2>
        <p className="text-muted-foreground text-sm">
          {actor.name} · {actor.email} · {actor.role.toLowerCase()}
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Appearance</h2>
        <ThemeToggle />
      </section>
      {actor.role === "ADMIN" && (
        <p className="text-muted-foreground text-sm">Default tax rate and company settings are added in Phase 4.</p>
      )}
    </div>
  );
}
