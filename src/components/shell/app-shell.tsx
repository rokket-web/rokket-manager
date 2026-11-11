import type { Actor } from "@/server/authz/session";
import { navFor } from "@/server/authz/policy";
import { ThemeToggle } from "./theme-toggle";
import { SignOutButton } from "./sign-out-button";
import { NavLinks } from "./nav-links";
import { portalUnreadCount, unreadFromClientCount } from "@/server/services/messages";

export async function AppShell({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  const nav = navFor(actor.role);
  // Live unread badges: clients on their Messages tab, admins on Clients (total across all clients).
  // A hiccup here must never break the whole page, so a failed count just shows no badge.
  const unread =
    actor.role === "CLIENT" && actor.clientId
      ? {
          href: "/portal/messages",
          endpoint: "/api/portal/messages/unread",
          count: await portalUnreadCount(actor).catch(() => 0),
          hideWhenActive: true,
        }
      : actor.role === "ADMIN"
        ? {
            href: "/clients",
            endpoint: "/api/clients/unread-messages",
            count: await unreadFromClientCount(actor).catch(() => 0),
          }
        : undefined;
  const initial = actor.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex min-h-screen md:p-8">
      <div className="bg-background mx-auto flex w-full max-w-[1600px] flex-col overflow-hidden shadow-2xl md:flex-row md:rounded-2xl">
        <aside className="bg-sidebar border-sidebar-border md:w-60 md:shrink-0 border-b md:border-r md:border-b-0">
          <div className="flex items-center justify-between px-6 py-5 md:block">
            <span className="text-xl font-semibold tracking-tight">Rokket</span>
            <span className="text-muted-foreground text-xs capitalize md:mt-0.5 md:block">
              {actor.role.toLowerCase()}
            </span>
          </div>
          <NavLinks items={nav.map(({ label, href }) => ({ label, href }))} unread={unread} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-end gap-3 px-6 py-4">
            <span className="text-muted-foreground mr-auto truncate text-sm">{actor.name}</span>
            <ThemeToggle />
            <SignOutButton />
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-full bg-violet-600 text-sm font-medium text-white"
            >
              {initial}
            </span>
          </header>
          <main className="flex-1 px-6 pt-2 pb-8 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
