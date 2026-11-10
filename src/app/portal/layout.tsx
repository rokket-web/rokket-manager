import { AppShell } from "@/components/shell/app-shell";
import { requireActor } from "@/server/authz/session";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor(["CLIENT"]);
  return (
    <AppShell actor={actor}>
      {actor.clientId ? (
        children
      ) : (
        <p role="alert" className="text-sm">
          Your account is not linked to a client yet. Please contact us.
        </p>
      )}
    </AppShell>
  );
}
