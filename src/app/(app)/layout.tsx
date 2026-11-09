import { AppShell } from "@/components/shell/app-shell";
import { requireActor } from "@/server/authz/session";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  return <AppShell actor={actor}>{children}</AppShell>;
}
