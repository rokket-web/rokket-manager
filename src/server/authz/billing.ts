import { ForbiddenError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";

export type BillingAction = "billing:read" | "billing:write";

/** Billing is admin-only. Staff never see quotes, invoices, payments or rates. Portal clients use the Phase 5 layer. */
export function canBilling(role: ActorLike["role"], action: BillingAction): boolean {
  return action === "billing:read" || action === "billing:write" ? role === "ADMIN" : false;
}

export function assertBilling(actor: ActorLike, action: BillingAction): void {
  if (!canBilling(actor.role, action)) throw new ForbiddenError();
}
