import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertProject } from "@/server/authz/projects";
import { db, withRetry } from "@/server/db";
import { NotFoundError } from "@/server/errors";

/**
 * What a client can see is decided here, by admins only (staff can manage tasks but not expose them).
 * Everything defaults to hidden. Hiding the project hides everything beneath it without losing the item flags.
 */
export async function getSharingOverview(actor: ActorLike, projectId: string) {
  assertProject(actor, "project:write");
  const p = await withRetry(() =>
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        visibleToClient: true,
        client: { select: { id: true, name: true, portalUser: { select: { active: true } } } },
        milestones: {
          orderBy: [{ position: "asc" }, { dueDate: "asc" }],
          select: { id: true, title: true, status: true, visibleToClient: true },
        },
        tasks: {
          orderBy: [{ milestoneId: "asc" }, { createdAt: "asc" }],
          select: { id: true, title: true, status: true, visibleToClient: true },
        },
      },
    }),
  );
  if (!p) throw new NotFoundError("Project not found.");
  return p;
}

export async function setProjectVisibility(actor: ActorLike, projectId: string, visible: boolean) {
  assertProject(actor, "project:write");
  await db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: projectId }, select: { name: true, clientId: true, visibleToClient: true } });
    if (!p) throw new NotFoundError("Project not found.");
    if (p.visibleToClient === visible) return;
    await tx.project.update({ where: { id: projectId }, data: { visibleToClient: visible } });
    await tx.activity.create({
      data: {
        clientId: p.clientId,
        actorId: actor.id,
        type: visible ? "project.shared" : "project.unshared",
        summary: `Project ${p.name} ${visible ? "shared with" : "hidden from"} the client portal`,
      },
    });
    await audit({ actorId: actor.id, action: visible ? "project.share" : "project.unshare", entity: "Project", entityId: projectId }, tx);
  });
}

/** Share or hide specific milestones/tasks (ids), or every one in the project (ids = null). Ids from other projects are ignored. */
export async function setItemsVisibility(
  actor: ActorLike,
  projectId: string,
  kind: "milestone" | "task",
  ids: string[] | null,
  visible: boolean,
) {
  assertProject(actor, "project:write");
  if (kind !== "milestone" && kind !== "task") throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!p) throw new NotFoundError("Project not found.");
    const where = { projectId, ...(ids ? { id: { in: ids } } : {}) };
    const data = { visibleToClient: visible };
    const res = kind === "task" ? await tx.task.updateMany({ where, data }) : await tx.milestone.updateMany({ where, data });
    await audit(
      { actorId: actor.id, action: "project.share.items", entity: "Project", entityId: projectId, meta: { kind, visible, count: res.count, all: ids === null } },
      tx,
    );
    return res.count;
  });
}
