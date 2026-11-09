import type { Prisma } from "@/generated/prisma/client";
import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertProject, canProject, projectScope } from "@/server/authz/projects";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { commentInputSchema, milestoneInputSchema, taskInputSchema, TASK_STATUSES } from "@/lib/validation/project";
import { z } from "zod";

type Tx = Prisma.TransactionClient;

async function requireProject(tx: Tx, actor: ActorLike, projectId: string) {
  const p = await tx.project.findFirst({
    where: { AND: [{ id: projectId }, projectScope(actor)] },
    select: { id: true },
  });
  if (!p) throw new NotFoundError("Project not found.");
}

async function checkRefs(tx: Tx, projectId: string, assigneeId: string | null, milestoneId: string | null) {
  if (
    assigneeId &&
    !(await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } }))
  ) {
    throw new z.ZodError([
      { code: "custom", path: ["assigneeId"], message: "Assignee must be a member of the project", input: assigneeId },
    ]);
  }
  if (milestoneId && !(await tx.milestone.findFirst({ where: { id: milestoneId, projectId }, select: { id: true } }))) {
    throw new z.ZodError([
      { code: "custom", path: ["milestoneId"], message: "Milestone must belong to this project", input: milestoneId },
    ]);
  }
}

// ---------- milestones (admin) ----------

export async function createMilestone(actor: ActorLike, projectId: string, raw: unknown) {
  assertProject(actor, "project:write");
  const { billable, ...input } = milestoneInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await requireProject(tx, actor, projectId);
    const last = await tx.milestone.aggregate({ where: { projectId }, _max: { position: true } });
    const m = await tx.milestone.create({
      data: {
        ...input,
        projectId,
        billableCents: billable,
        position: (last._max.position ?? -1) + 1,
        completedAt: input.status === "COMPLETED" ? new Date() : null,
      },
    });
    await audit({ actorId: actor.id, action: "milestone.create", entity: "Milestone", entityId: m.id }, tx);
    return m;
  });
}

export async function updateMilestone(actor: ActorLike, milestoneId: string, raw: unknown) {
  assertProject(actor, "project:write");
  const { billable, ...input } = milestoneInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.milestone.findUnique({ where: { id: milestoneId } });
    if (!before) throw new NotFoundError("Milestone not found.");
    const completedAt = input.status === "COMPLETED" ? (before.completedAt ?? new Date()) : null;
    const m = await tx.milestone.update({
      where: { id: milestoneId },
      data: { ...input, billableCents: billable, completedAt },
    });
    await audit({ actorId: actor.id, action: "milestone.update", entity: "Milestone", entityId: milestoneId }, tx);
    return m;
  });
}

export async function deleteMilestone(actor: ActorLike, milestoneId: string) {
  assertProject(actor, "project:write");
  await db.$transaction(async (tx) => {
    const m = await tx.milestone.findUnique({ where: { id: milestoneId }, select: { id: true } });
    if (!m) throw new NotFoundError("Milestone not found.");
    await tx.milestone.delete({ where: { id: milestoneId } }); // tasks keep existing, milestoneId set null
    await audit({ actorId: actor.id, action: "milestone.delete", entity: "Milestone", entityId: milestoneId }, tx);
  });
}

// ---------- tasks ----------

export async function listTasks(
  actor: ActorLike,
  projectId: string,
  filter: { status?: string; assigneeId?: string; mine?: boolean } = {},
) {
  assertProject(actor, "project:read");
  const where: Prisma.TaskWhereInput = { projectId, project: projectScope(actor) };
  if (filter.status && (TASK_STATUSES as readonly string[]).includes(filter.status))
    where.status = filter.status as (typeof TASK_STATUSES)[number];
  if (filter.mine) where.assigneeId = actor.id;
  else if (filter.assigneeId) where.assigneeId = filter.assigneeId;
  return withRetry(() =>
    db.task.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { priority: "desc" },
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      take: 500,
      include: {
        assignee: { select: { id: true, name: true } },
        milestone: { select: { id: true, title: true } },
        _count: { select: { comments: true } },
      },
    }),
  );
}

export async function getTask(actor: ActorLike, taskId: string) {
  assertProject(actor, "project:read");
  const t = await withRetry(() =>
    db.task.findFirst({
      where: { id: taskId, project: projectScope(actor) },
      include: {
        assignee: { select: { id: true, name: true } },
        milestone: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: "asc" } },
      },
    }),
  );
  if (!t) throw new NotFoundError("Task not found.");
  const ids = [...new Set(t.comments.map((c) => c.authorId).filter(Boolean) as string[])];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  return { ...t, authorNames: Object.fromEntries(users.map((u) => [u.id, u.name])) };
}

export async function createTask(actor: ActorLike, projectId: string, raw: unknown) {
  assertProject(actor, "task:write");
  const input = taskInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await requireProject(tx, actor, projectId);
    await checkRefs(tx, projectId, input.assigneeId, input.milestoneId);
    const t = await tx.task.create({
      data: { ...input, projectId, completedAt: input.status === "DONE" ? new Date() : null },
    });
    await audit({ actorId: actor.id, action: "task.create", entity: "Task", entityId: t.id }, tx);
    return t;
  });
}

async function loadTask(tx: Tx, actor: ActorLike, taskId: string) {
  const t = await tx.task.findFirst({ where: { id: taskId, project: projectScope(actor) } });
  if (!t) throw new NotFoundError("Task not found.");
  return t;
}

export async function updateTask(actor: ActorLike, taskId: string, raw: unknown) {
  assertProject(actor, "task:write");
  const input = taskInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await loadTask(tx, actor, taskId);
    await checkRefs(tx, before.projectId, input.assigneeId, input.milestoneId);
    const completedAt = input.status === "DONE" ? (before.completedAt ?? new Date()) : null;
    const t = await tx.task.update({ where: { id: taskId }, data: { ...input, completedAt } });
    await audit({ actorId: actor.id, action: "task.update", entity: "Task", entityId: taskId }, tx);
    return t;
  });
}

export async function setTaskStatus(actor: ActorLike, taskId: string, rawStatus: unknown) {
  assertProject(actor, "task:write");
  const status = z.enum(TASK_STATUSES).parse(rawStatus);
  await db.$transaction(async (tx) => {
    const before = await loadTask(tx, actor, taskId);
    if (before.status === status) return;
    await tx.task.update({
      where: { id: taskId },
      data: { status, completedAt: status === "DONE" ? new Date() : null },
    });
    await audit(
      {
        actorId: actor.id,
        action: "task.status",
        entity: "Task",
        entityId: taskId,
        meta: { from: before.status, to: status },
      },
      tx,
    );
  });
}

export async function deleteTask(actor: ActorLike, taskId: string) {
  assertProject(actor, "task:write");
  await db.$transaction(async (tx) => {
    await loadTask(tx, actor, taskId);
    await tx.task.delete({ where: { id: taskId } });
    await audit({ actorId: actor.id, action: "task.delete", entity: "Task", entityId: taskId }, tx);
  });
}

// ---------- comments ----------

export async function addComment(actor: ActorLike, taskId: string, raw: unknown) {
  assertProject(actor, "task:write");
  const { body } = commentInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await loadTask(tx, actor, taskId);
    const c = await tx.taskComment.create({ data: { taskId, authorId: actor.id, body } });
    await audit({ actorId: actor.id, action: "comment.create", entity: "TaskComment", entityId: c.id }, tx);
    return c;
  });
}

export async function deleteComment(actor: ActorLike, commentId: string) {
  assertProject(actor, "task:write");
  await db.$transaction(async (tx) => {
    const c = await tx.taskComment.findUnique({
      where: { id: commentId },
      include: { task: { select: { projectId: true } } },
    });
    if (!c) throw new NotFoundError("Comment not found.");
    await requireProject(tx, actor, c.task.projectId);
    if (!canProject(actor.role, "project:write") && c.authorId !== actor.id) throw new ForbiddenError();
    await tx.taskComment.delete({ where: { id: commentId } });
    await audit({ actorId: actor.id, action: "comment.delete", entity: "TaskComment", entityId: commentId }, tx);
  });
}
