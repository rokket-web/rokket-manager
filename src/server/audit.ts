import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

export type AuditInput = {
  actorId?: string | null;
  action: string; // e.g. "user.login", "client.create"
  entity: string;
  entityId?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
};

type Writer = Pick<typeof db, "auditLog">;

/**
 * Record who did what. Pass a transaction client as `tx` to make the audit
 * row commit atomically with the change it describes.
 */
export async function audit(input: AuditInput, tx: Writer = db) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      meta: input.meta,
      ip: input.ip ?? null,
    },
  });
}
