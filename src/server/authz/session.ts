import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { homeFor, type Role } from "@/server/authz/policy";

export type Actor = {
  id: string;
  name: string;
  email: string;
  role: Role;
  clientId: string | null;
};

const ROLES: Role[] = ["ADMIN", "STAFF", "CLIENT"];

/** The signed-in, active user, or null. Fails closed on unknown roles. */
export async function getActor(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const u = session?.user as
    { id: string; name: string; email: string; role?: string; active?: boolean; clientId?: string | null } | undefined;
  if (!u || u.active === false) return null;
  if (!u.role || !ROLES.includes(u.role as Role)) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role as Role, clientId: u.clientId ?? null };
}

/**
 * Authorization gate for pages, layouts, actions and the data layer.
 * Not signed in -> /login. Wrong role -> that role's own home (never a leak).
 */
export async function requireActor(allowed?: Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (allowed && !allowed.includes(actor.role)) redirect(homeFor(actor.role));
  return actor;
}
