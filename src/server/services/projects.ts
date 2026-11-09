import type { Prisma } from "@/generated/prisma/client";
import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertProject, canProject, projectScope } from "@/server/authz/projects";
import { NotFoundError } from "@/server/errors";
import { projectInputSchema, projectListSchema } from "@/lib/validation/project";
import { getStorage } from "@/server/storage";

type Tx = Prisma.TransactionClient;

/** Staff must never receive budget or rate data. */
function stripMoney<T extends { budgetCents?: number | null; hourlyRateCents?: number | null }>(
  actor: ActorLike,
  p: T,
): T {
  if (canProject(actor.role, "money:read")) return p;
  return { ...p, budgetCents: null, hourlyRateCents: null };
}

function columns(input: ReturnType<typeof projectInputSchema.parse>) {
  const { budget, hourlyRate, ...rest } = input;
  return { ...rest, budgetCents: budget, hourlyRateCents: hourlyRate };
}

export async function listProjects(actor: ActorLike, rawQuery: unknown) {
  assertProject(actor, "project:read");
  const q = projectListSchema.parse(rawQuery ?? {});
  const and: Prisma.ProjectWhereInput[] = [projectScope(actor)];
  if (q.status) and.push({ status: q.status });
  if (q.clientId) and.push({ clientId: q.clientId });
  if (q.q)
    and.push({
      OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { client: { name: { contains: q.q, mode: "insensitive" } } },
      ],
    });
  const where: Prisma.ProjectWhereInput = { AND: and };

  const [rows, total] = await withRetry(() =>
    db.$transaction([
      db.project.findMany({
        where,
        orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { client: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
      }),
      db.project.count({ where }),
    ]),
  );
  const done = rows.length
    ? await db.task.groupBy({
        by: ["projectId"],
        where: { projectId: { in: rows.map((r) => r.id) }, status: "DONE" },
        _count: true,
      })
    : [];
  const doneBy = Object.fromEntries(done.map((d) => [d.projectId, d._count]));
  const items = rows.map((r) => ({ ...stripMoney(actor, r), tasksDone: doneBy[r.id] ?? 0 }));
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
    query: q,
  };
}

export async function listProjectsForClient(actor: ActorLike, clientId: string) {
  assertProject(actor, "project:read");
  const rows = await withRetry(() =>
    db.project.findMany({
      where: { AND: [{ clientId }, projectScope(actor)] },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
  return rows.map((r) => stripMoney(actor, r));
}

/** Projects the actor can pick when logging time or uploading (id + name + client). */
export async function listAssignableProjects(actor: ActorLike) {
  assertProject(actor, "project:read");
  return withRetry(() =>
    db.project.findMany({
      where: { AND: [projectScope(actor), { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }] },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, client: { select: { name: true } } },
    }),
  );
}

export async function getProject(actor: ActorLike, id: string) {
  assertProject(actor, "project:read");
  const p = await withRetry(() =>
    db.project.findFirst({
      where: { AND: [{ id }, projectScope(actor)] },
      include: {
        client: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, role: true } } } },
        milestones: { orderBy: [{ position: "asc" }, { dueDate: "asc" }] },
      },
    }),
  );
  if (!p) throw new NotFoundError("Project not found.");
  const safe = stripMoney(actor, p);
  return {
    ...safe,
    milestones: safe.milestones.map((m) => (canProject(actor.role, "money:read") ? m : { ...m, billableCents: null })),
  };
}

/** Internal staff/admin users who can be assigned to projects. */
export async function listAssignableUsers(actor: ActorLike) {
  assertProject(actor, "project:read");
  return db.user.findMany({
    where: { role: { in: ["ADMIN", "STAFF"] }, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

export async function createProject(actor: ActorLike, raw: unknown) {
  assertProject(actor, "project:write");
  const input = projectInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: input.clientId }, select: { id: true } });
    if (!client) throw new NotFoundError("Client not found.");
    const p = await tx.project.create({ data: columns(input) });
    await tx.activity.create({
      data: { clientId: p.clientId, actorId: actor.id, type: "project.created", summary: `Project created: ${p.name}` },
    });
    await audit(
      { actorId: actor.id, action: "project.create", entity: "Project", entityId: p.id, meta: { name: p.name } },
      tx,
    );
    return p;
  });
}

export async function updateProject(actor: ActorLike, id: string, raw: unknown) {
  assertProject(actor, "project:write");
  return db.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Project not found.");
    // A project cannot move between clients, so the client always comes from the stored row.
    const input = projectInputSchema.parse({ ...(raw as object), clientId: before.clientId });
    const { clientId: _ignored, ...data } = columns(input);
    void _ignored;
    const p = await tx.project.update({ where: { id }, data });
    if (before.status !== p.status) {
      await tx.activity.create({
        data: {
          clientId: p.clientId,
          actorId: actor.id,
          type: "project.status_changed",
          summary: `Project ${p.name}: ${before.status.toLowerCase()} to ${p.status.toLowerCase()}`,
        },
      });
    }
    await audit({ actorId: actor.id, action: "project.update", entity: "Project", entityId: id }, tx);
    return p;
  });
}

export async function deleteProject(actor: ActorLike, id: string) {
  assertProject(actor, "project:write");
  const keys = await db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id }, select: { name: true, clientId: true } });
    if (!p) throw new NotFoundError("Project not found.");
    const files = await tx.fileAsset.findMany({ where: { projectId: id }, select: { storageKey: true } });
    await audit(
      { actorId: actor.id, action: "project.delete", entity: "Project", entityId: id, meta: { name: p.name } },
      tx,
    );
    await tx.activity.create({
      data: { clientId: p.clientId, actorId: actor.id, type: "project.deleted", summary: `Project deleted: ${p.name}` },
    });
    await tx.project.delete({ where: { id } });
    return files.map((f) => f.storageKey);
  });
  // Best effort after commit: remove stored objects. Orphans are swept in Phase 6.
  try {
    const storage = getStorage();
    await Promise.all(keys.map((k) => storage.remove(k)));
  } catch {
    /* storage not configured or transient failure */
  }
}

export async function setProjectMembers(actor: ActorLike, projectId: string, userIds: string[]) {
  assertProject(actor, "project:write");
  const ids = [...new Set(userIds)].slice(0, 50);
  await db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!p) throw new NotFoundError("Project not found.");
    const valid = await tx.user.findMany({
      where: { id: { in: ids }, role: { in: ["ADMIN", "STAFF"] }, active: true },
      select: { id: true },
    });
    await tx.projectMember.deleteMany({ where: { projectId } });
    if (valid.length) await tx.projectMember.createMany({ data: valid.map((u) => ({ projectId, userId: u.id })) });
    // Unassign tasks whose assignee is no longer on the project.
    await tx.task.updateMany({
      where: { projectId, assigneeId: { notIn: valid.map((u) => u.id) } },
      data: { assigneeId: null },
    });
    await audit(
      {
        actorId: actor.id,
        action: "project.members",
        entity: "Project",
        entityId: projectId,
        meta: { count: valid.length },
      },
      tx,
    );
  });
}

// ---------- dashboard rollups ----------

export async function getProjectDashboard(actor: ActorLike, projectId: string) {
  const project = await getProject(actor, projectId); // enforces permission + scope
  const showMoney = canProject(actor.role, "money:read");
  const horizon = new Date(Date.now() + 14 * 86_400_000);

  const [taskCounts, milestoneCounts, time, upcomingTasks, upcomingMilestones, billable] = await withRetry(() =>
    Promise.all([
      db.task.groupBy({ by: ["status"], where: { projectId }, _count: true }),
      db.milestone.groupBy({ by: ["status"], where: { projectId }, _count: true }),
      db.timeEntry.aggregate({ where: { projectId, endedAt: { not: null } }, _sum: { minutes: true } }),
      db.task.findMany({
        where: { projectId, status: { not: "DONE" }, dueDate: { not: null, lte: horizon } },
        orderBy: { dueDate: "asc" },
        take: 20,
        select: { id: true, title: true, dueDate: true, priority: true, assignee: { select: { name: true } } },
      }),
      db.milestone.findMany({
        where: { projectId, status: { not: "COMPLETED" }, dueDate: { not: null, lte: horizon } },
        orderBy: { dueDate: "asc" },
        take: 20,
        select: { id: true, title: true, dueDate: true },
      }),
      showMoney
        ? db.$queryRaw<{ minutes: bigint | null; cents: bigint | null }[]>`
            SELECT SUM(minutes) AS minutes, SUM(FLOOR((minutes * "rateCents" * 2 + 60) / 120)) AS cents
            FROM "TimeEntry" WHERE "projectId" = ${projectId} AND billable AND "endedAt" IS NOT NULL`
        : db.timeEntry.aggregate({
            where: { projectId, billable: true, endedAt: { not: null } },
            _sum: { minutes: true },
          }),
    ]),
  );

  const byStatus = Object.fromEntries(taskCounts.map((t) => [t.status, t._count])) as Record<string, number>;
  const tasksTotal = taskCounts.reduce((n, t) => n + t._count, 0);
  const tasksDone = byStatus.DONE ?? 0;
  const msTotal = milestoneCounts.reduce((n, t) => n + t._count, 0);
  const msDone = milestoneCounts.find((m) => m.status === "COMPLETED")?._count ?? 0;

  let billableMinutes = 0;
  let billableCents = 0;
  if (showMoney) {
    const row = (billable as { minutes: bigint | null; cents: bigint | null }[])[0];
    billableMinutes = Number(row?.minutes ?? 0);
    billableCents = Number(row?.cents ?? 0);
  } else {
    billableMinutes = (billable as { _sum: { minutes: number | null } })._sum.minutes ?? 0;
  }

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const deadlines = [
    ...upcomingTasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      dueDate: t.dueDate!,
      overdue: t.dueDate! < today,
      who: t.assignee?.name ?? null,
    })),
    ...upcomingMilestones.map((m) => ({
      kind: "milestone" as const,
      id: m.id,
      title: m.title,
      dueDate: m.dueDate!,
      overdue: m.dueDate! < today,
      who: null,
    })),
  ].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return {
    project,
    tasks: { total: tasksTotal, done: tasksDone, byStatus },
    milestones: { total: msTotal, done: msDone },
    progressPercent: tasksTotal
      ? Math.round((tasksDone / tasksTotal) * 100)
      : msTotal
        ? Math.round((msDone / msTotal) * 100)
        : 0,
    totalMinutes: time._sum.minutes ?? 0,
    billableMinutes,
    // Money fields exist only for roles allowed to see money.
    ...(showMoney
      ? {
          billableCents,
          budgetCents: project.budgetCents,
          budgetUsedPercent: project.budgetCents ? Math.round((billableCents / project.budgetCents) * 100) : null,
        }
      : {}),
    deadlines,
  };
}
