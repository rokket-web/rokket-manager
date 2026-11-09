import type { Prisma } from "@/generated/prisma/client";
import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertProject, canProject, projectScope } from "@/server/authz/projects";
import { ConflictError, NotFoundError } from "@/server/errors";
import { manualTimeSchema, timerStartSchema } from "@/lib/validation/project";
import { z } from "zod";

type Tx = Prisma.TransactionClient;
const MAX_ENTRY_MINUTES = 24 * 60;

async function projectForTime(tx: Tx, actor: ActorLike, projectId: string, taskId: string | null) {
  const p = await tx.project.findFirst({
    where: { AND: [{ id: projectId }, projectScope(actor)] },
    select: { id: true, hourlyRateCents: true },
  });
  if (!p) throw new NotFoundError("Project not found.");
  if (taskId && !(await tx.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } }))) {
    throw new z.ZodError([
      { code: "custom", path: ["taskId"], message: "Task must belong to this project", input: taskId },
    ]);
  }
  return p;
}

/** Staff never see rates; admin sees all. */
function view<T extends { rateCents: number }>(actor: ActorLike, e: T): T {
  return canProject(actor.role, "money:read") ? e : { ...e, rateCents: 0 };
}

export async function getRunningTimer(actor: ActorLike) {
  assertProject(actor, "time:write");
  const e = await withRetry(() =>
    db.timeEntry.findFirst({
      where: { userId: actor.id, endedAt: null },
      include: { project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    }),
  );
  return e ? view(actor, e) : null;
}

export async function startTimer(actor: ActorLike, raw: unknown) {
  assertProject(actor, "time:write");
  const input = timerStartSchema.parse(raw);
  try {
    return await db.$transaction(async (tx) => {
      const p = await projectForTime(tx, actor, input.projectId, input.taskId);
      if (await tx.timeEntry.findFirst({ where: { userId: actor.id, endedAt: null }, select: { id: true } })) {
        throw new ConflictError("You already have a timer running. Stop it first.");
      }
      const e = await tx.timeEntry.create({
        data: {
          projectId: p.id,
          taskId: input.taskId,
          userId: actor.id,
          startedAt: new Date(),
          description: input.description,
          billable: input.billable,
          rateCents: p.hourlyRateCents ?? 0,
        },
      });
      await audit({ actorId: actor.id, action: "time.start", entity: "TimeEntry", entityId: e.id }, tx);
      return view(actor, e);
    });
  } catch (err) {
    // Two simultaneous starts: the partial unique index rejects the second.
    if ((err as { code?: string })?.code === "P2002")
      throw new ConflictError("You already have a timer running. Stop it first.");
    throw err;
  }
}

export async function stopTimer(actor: ActorLike) {
  assertProject(actor, "time:write");
  return db.$transaction(async (tx) => {
    const running = await tx.timeEntry.findFirst({ where: { userId: actor.id, endedAt: null } });
    if (!running) throw new NotFoundError("No timer is running.");
    const now = new Date();
    const minutes = Math.min(
      MAX_ENTRY_MINUTES,
      Math.max(1, Math.round((now.getTime() - running.startedAt.getTime()) / 60_000)),
    );
    const e = await tx.timeEntry.update({ where: { id: running.id }, data: { endedAt: now, minutes } });
    await audit({ actorId: actor.id, action: "time.stop", entity: "TimeEntry", entityId: e.id, meta: { minutes } }, tx);
    return view(actor, e);
  });
}

export async function addManualEntry(actor: ActorLike, raw: unknown) {
  assertProject(actor, "time:write");
  const input = manualTimeSchema.parse(raw);
  const minutes = input.hours * 60 + input.minutes;
  if (minutes < 1 || minutes > MAX_ENTRY_MINUTES) {
    throw new z.ZodError([
      { code: "custom", path: ["minutes"], message: "Enter a duration between 1 minute and 24 hours", input: minutes },
    ]);
  }
  const startedAt = new Date(`${input.date}T09:00:00.000Z`);
  if (Number.isNaN(startedAt.getTime()))
    throw new z.ZodError([{ code: "custom", path: ["date"], message: "Enter a valid date", input: input.date }]);
  return db.$transaction(async (tx) => {
    const p = await projectForTime(tx, actor, input.projectId, input.taskId);
    const e = await tx.timeEntry.create({
      data: {
        projectId: p.id,
        taskId: input.taskId,
        userId: actor.id,
        startedAt,
        endedAt: new Date(startedAt.getTime() + minutes * 60_000),
        minutes,
        description: input.description,
        billable: input.billable,
        rateCents: p.hourlyRateCents ?? 0,
      },
    });
    await audit(
      { actorId: actor.id, action: "time.manual", entity: "TimeEntry", entityId: e.id, meta: { minutes } },
      tx,
    );
    return view(actor, e);
  });
}

export async function deleteTimeEntry(actor: ActorLike, entryId: string) {
  assertProject(actor, "time:write");
  await db.$transaction(async (tx) => {
    const e = await tx.timeEntry.findFirst({ where: { id: entryId, project: projectScope(actor) } });
    // Staff can only touch their own entries; admin any. Wrong owner looks like "not found".
    if (!e || (actor.role !== "ADMIN" && e.userId !== actor.id)) throw new NotFoundError("Time entry not found.");
    await tx.timeEntry.delete({ where: { id: entryId } });
    await audit({ actorId: actor.id, action: "time.delete", entity: "TimeEntry", entityId: entryId }, tx);
  });
}

export async function listTimeEntries(
  actor: ActorLike,
  opts: { projectId?: string; page?: number; pageSize?: number } = {},
) {
  assertProject(actor, "time:write");
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 25);
  const where: Prisma.TimeEntryWhereInput = {
    project: projectScope(actor),
    endedAt: { not: null },
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
    ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
  };
  const [rows, total] = await withRetry(() =>
    db.$transaction([
      db.timeEntry.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      db.timeEntry.count({ where }),
    ]),
  );
  return {
    items: rows.map((r) => view(actor, r)),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
