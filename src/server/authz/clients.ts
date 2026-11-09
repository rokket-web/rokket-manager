import type { Prisma } from "@/generated/prisma/client";
import { ForbiddenError } from "@/server/errors";
import type { Role } from "@/server/authz/policy";

export type ActorLike = { id: string; role: Role; clientId?: string | null };
export type ClientAction = "client:read" | "client:write" | "client:delete" | "client:import" | "client:export";

const MATRIX: Record<Role, ClientAction[]> = {
  ADMIN: ["client:read", "client:write", "client:delete", "client:import", "client:export"],
  STAFF: ["client:read"], // read-only, and only for clients in scope (see clientScope)
  CLIENT: [], // portal users never touch the internal client services
};

export function can(role: Role, action: ClientAction): boolean {
  return MATRIX[role]?.includes(action) ?? false;
}

export function assertCan(actor: ActorLike, action: ClientAction): void {
  if (!can(actor.role, action)) throw new ForbiddenError();
}

/**
 * Row-level scope applied to EVERY client query.
 * Admin: all. Staff: only clients that have a project they are a member of. Client role: never reaches this layer.
 */
export function clientScope(actor: ActorLike): Prisma.ClientWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role === "STAFF") return { projects: { some: { members: { some: { userId: actor.id } } } } };
  return { id: { in: [] } };
}
