import { AppShell } from "@/components/shell/app-shell";
import { requireActor } from "@/server/authz/session";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor(["CLIENT"]);
  return <AppShell actor={actor}>{children}</AppShell>;
}
