import Link from "next/link";
import type { Actor } from "@/server/authz/session";
import { navFor } from "@/server/authz/policy";
import { ThemeToggle } from "./theme-toggle";
import { SignOutButton } from "./sign-out-button";

export function AppShell({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  const nav = navFor(actor.role);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:block">
          <span className="text-lg font-semibold">Rokket</span>
          <span className="text-muted-foreground text-xs md:mt-1 md:block">{actor.role.toLowerCase()}</span>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:bg-accent rounded-md px-3 py-2 text-sm whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-2 border-b px-4 py-2">
          <span className="text-muted-foreground mr-auto truncate text-sm">{actor.name}</span>
          <ThemeToggle />
          <SignOutButton />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
