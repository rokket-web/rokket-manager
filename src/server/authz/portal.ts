import { ForbiddenError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";

/**
 * Every portal query is scoped by the SIGNED-IN user's own clientId, never an id from the request.
 * Fails closed: anyone who is not a CLIENT user linked to a client gets Forbidden.
 */
export function portalClientId(actor: ActorLike): string {
  if (actor.role !== "CLIENT" || !actor.clientId) throw new ForbiddenError();
  return actor.clientId;
}
