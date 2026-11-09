import type { Prisma } from "@/generated/prisma/client";
import { ForbiddenError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";

export type ProjectAction =
  | "project:read"
  | "project:write" // create/edit/delete projects, manage members, milestones
  | "task:write" // tasks and comments
  | "time:write"
  | "file:write"
  | "money:read"; // budgets, rates, billable amounts

const ADMIN_ONLY: ProjectAction[] = ["project:write", "money:read"];
const STAFF: ProjectAction[] = ["project:read", "task:write", "time:write", "file:write"];

export function canProject(role: ActorLike["role"], action: ProjectAction): boolean {
  if (role === "ADMIN") return true;
  if (role === "STAFF") return STAFF.includes(action) && !ADMIN_ONLY.includes(action);
  return false; // portal clients never use internal project services
}

export function assertProject(actor: ActorLike, action: ProjectAction): void {
  if (!canProject(actor.role, action)) throw new ForbiddenError();
}

/** Admin sees all projects; staff only projects they are a member of; clients none (portal has its own layer). */
export function projectScope(actor: ActorLike): Prisma.ProjectWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role === "STAFF") return { members: { some: { userId: actor.id } } };
  return { id: { in: [] } };
}
