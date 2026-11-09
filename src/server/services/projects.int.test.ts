import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import type { FileStorage } from "@/server/storage";
import * as projects from "./projects";
import * as tasks from "./tasks";
import * as time from "./time";
import * as files from "./files";

const P = `ZZTEST-${Math.random().toString(36).slice(2, 8)}`;
let admin: ActorLike;
let staffA: ActorLike; // member
let staffB: ActorLike; // not a member
const portal: ActorLike = { id: "portal-x", role: "CLIENT", clientId: "x" };
let clientId: string;
let projectId: string;

const mem = new Map<string, number>();
const fakeStorage: FileStorage = {
  createUploadUrl: async (k) => `https://upload.test/${k}`,
  createDownloadUrl: async (k, { filename }) => `https://download.test/${k}?name=${filename}`,
  stat: async (k) => (mem.has(k) ? { size: mem.get(k)! } : null),
  remove: async (k) => void mem.delete(k),
};

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  const s = await db.user.findUniqueOrThrow({ where: { email: "staff@rokket.test" } });
  admin = { id: a.id, role: "ADMIN" };
  staffA = { id: s.id, role: "STAFF" };
  // A second staff user who is never a project member.
  const b = await db.user.create({
    data: { name: `${P} Staff B`, email: `${P.toLowerCase()}@rokket.test`, role: "STAFF" },
  });
  staffB = { id: b.id, role: "STAFF" };
  const c = await db.client.create({ data: { name: `${P} Client` } });
  clientId = c.id;
  const p = await projects.createProject(admin, {
    clientId,
    name: `${P} Project`,
    budget: "1000",
    hourlyRate: "100",
    status: "ACTIVE",
  });
  projectId = p.id;
  await projects.setProjectMembers(admin, projectId, [a.id, s.id]);
});

afterAll(async () => {
  await db.timeEntry.deleteMany({ where: { user: { email: { contains: P.toLowerCase() } } } });
  await db.project.deleteMany({ where: { name: { contains: P } } });
  await db.client.deleteMany({ where: { name: { contains: P } } });
  await db.user.deleteMany({ where: { email: { contains: P.toLowerCase() } } });
  await db.$disconnect();
});

describe("projects", () => {
  it("validates input and keeps money as integer cents", async () => {
    await expect(projects.createProject(admin, { clientId, name: "" })).rejects.toBeInstanceOf(ZodError);
    await expect(projects.createProject(admin, { clientId, name: "x", budget: "abc" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      projects.createProject(admin, { clientId, name: "x", startDate: "2026-02-01", dueDate: "2026-01-01" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(projects.createProject(admin, { clientId: "nope", name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect([p.budgetCents, p.hourlyRateCents, p.currency]).toEqual([100000, 10000, "USD"]);
  });

  it("staff cannot create, edit, delete or manage members", async () => {
    await expect(projects.createProject(staffA, { clientId, name: `${P} no` })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(projects.updateProject(staffA, projectId, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(projects.deleteProject(staffA, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(projects.setProjectMembers(staffA, projectId, [staffA.id])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(tasks.createMilestone(staffA, projectId, { title: "m" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("staff see only their projects, and never budgets or rates", async () => {
    expect((await projects.listProjects(staffA, { q: P })).total).toBe(1);
    expect((await projects.listProjects(staffB, { q: P })).total).toBe(0);
    await expect(projects.getProject(staffB, projectId)).rejects.toBeInstanceOf(NotFoundError);
    const seen = await projects.getProject(staffA, projectId);
    expect([seen.budgetCents, seen.hourlyRateCents]).toEqual([null, null]);
    const adminView = await projects.getProject(admin, projectId);
    expect([adminView.budgetCents, adminView.hourlyRateCents]).toEqual([100000, 10000]);
  });

  it("portal client users have no access", async () => {
    await expect(projects.listProjects(portal, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(projects.getProject(portal, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(time.startTimer(portal, { projectId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      files.requestUpload(
        portal,
        { clientId, projectId, filename: "a.pdf", size: 10, mime: "application/pdf" },
        fakeStorage,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("milestones, tasks, comments", () => {
  it("runs the task lifecycle with member/milestone checks and completion timestamps", async () => {
    const m = await tasks.createMilestone(admin, projectId, { title: "M1", billable: "250.50" });
    expect(m.billableCents).toBe(25050);
    const t = await tasks.createTask(staffA, projectId, {
      title: "T1",
      priority: "HIGH",
      assigneeId: staffA.id,
      milestoneId: m.id,
      dueDate: "2026-12-01",
    });
    expect(t.status).toBe("TODO");
    await expect(tasks.createTask(staffA, projectId, { title: "bad", assigneeId: staffB.id })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(tasks.createTask(staffA, projectId, { title: "bad", milestoneId: "nope" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(tasks.createTask(staffB, projectId, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);

    await tasks.setTaskStatus(staffA, t.id, "DONE");
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).completedAt).not.toBeNull();
    await tasks.setTaskStatus(staffA, t.id, "IN_PROGRESS");
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).completedAt).toBeNull();
    await expect(tasks.setTaskStatus(staffA, t.id, "WRONG")).rejects.toBeInstanceOf(ZodError);

    const c = await tasks.addComment(staffA, t.id, { body: " hi " });
    expect(c.body).toBe("hi");
    await expect(tasks.deleteComment(admin, c.id)).resolves.toBeUndefined();
    expect((await tasks.listTasks(staffA, projectId, { mine: true })).map((x) => x.id)).toContain(t.id);
    await expect(tasks.listTasks(staffB, projectId)).resolves.toEqual([]); // not a member: scope filters everything out
    await expect(tasks.getTask(staffB, t.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removing a member unassigns their tasks", async () => {
    const t = await tasks.createTask(admin, projectId, { title: "T2", assigneeId: staffA.id });
    await projects.setProjectMembers(admin, projectId, [admin.id]);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();
    await projects.setProjectMembers(admin, projectId, [admin.id, staffA.id]);
  });
});

describe("time tracking", () => {
  it("starts and stops a timer, one at a time, snapshotting the rate", async () => {
    const e = await time.startTimer(admin, { projectId, description: "work", billable: "true" });
    expect(e.endedAt).toBeNull();
    await expect(time.startTimer(admin, { projectId })).rejects.toBeInstanceOf(ConflictError);
    // Two simultaneous starts for another user: exactly one wins (partial unique index backs the check).
    const results = await Promise.allSettled([
      time.startTimer(staffA, { projectId }),
      time.startTimer(staffA, { projectId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await db.timeEntry.update({ where: { id: e.id }, data: { startedAt: new Date(Date.now() - 90 * 60_000) } });
    const stopped = await time.stopTimer(admin);
    expect(stopped.minutes).toBe(90);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).rateCents).toBe(10000);
    await time.stopTimer(staffA);
    await expect(time.stopTimer(admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("adds manual entries with validation, and hides rates from staff", async () => {
    await expect(
      time.addManualEntry(staffA, { projectId, date: "2026-01-02", hours: "0", minutes: "0" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(time.addManualEntry(staffA, { projectId, date: "bad", hours: "1" })).rejects.toBeInstanceOf(ZodError);
    await expect(time.addManualEntry(staffB, { projectId, date: "2026-01-02", hours: "1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const e = await time.addManualEntry(staffA, {
      projectId,
      date: "2026-01-02",
      hours: "2",
      minutes: "30",
      billable: "true",
    });
    expect([e.minutes, e.rateCents]).toEqual([150, 0]); // staff view hides the rate
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).rateCents).toBe(10000);
  });

  it("staff only list and delete their own entries", async () => {
    const mine = await time.addManualEntry(staffA, { projectId, date: "2026-01-03", hours: "1" });
    const adminOwn = await time.addManualEntry(admin, { projectId, date: "2026-01-03", hours: "1" });
    const list = await time.listTimeEntries(staffA, { projectId });
    expect(list.items.every((i) => i.userId === staffA.id)).toBe(true);
    await expect(time.deleteTimeEntry(staffA, adminOwn.id)).rejects.toBeInstanceOf(NotFoundError);
    await time.deleteTimeEntry(staffA, mine.id);
    await time.deleteTimeEntry(admin, adminOwn.id);
  });
});

describe("dashboard rollups", () => {
  it("computes progress, hours and billable value with integer rounding, hiding money from staff", async () => {
    const p2 = await projects.createProject(admin, { clientId, name: `${P} Rollup`, budget: "100", hourlyRate: "100" });
    await projects.setProjectMembers(admin, p2.id, [admin.id, staffA.id]);
    await tasks.createTask(admin, p2.id, { title: "a", status: "DONE" });
    await tasks.createTask(admin, p2.id, { title: "b", status: "TODO" });
    await tasks.createTask(admin, p2.id, { title: "c", status: "TODO", dueDate: "2020-01-01" }); // overdue
    await time.addManualEntry(admin, {
      projectId: p2.id,
      date: "2026-01-05",
      hours: "1",
      minutes: "30",
      billable: "true",
    }); // 90m @ $100 = $150.00
    await time.addManualEntry(admin, {
      projectId: p2.id,
      date: "2026-01-05",
      hours: "0",
      minutes: "1",
      billable: "true",
    }); // 1m = $1.67
    await time.addManualEntry(admin, { projectId: p2.id, date: "2026-01-05", hours: "1", billable: "false" });
    const d = await projects.getProjectDashboard(admin, p2.id);
    expect(d.progressPercent).toBe(33);
    expect([d.totalMinutes, d.billableMinutes]).toEqual([151, 91]);
    expect(d).toMatchObject({ billableCents: 15167, budgetCents: 10000, budgetUsedPercent: 152 });
    expect(d.deadlines.some((x) => x.overdue)).toBe(true);

    const s = await projects.getProjectDashboard(staffA, p2.id);
    expect(s).not.toHaveProperty("billableCents");
    expect(s).not.toHaveProperty("budgetCents");
    expect(s.project.budgetCents).toBeNull();
    expect(s.billableMinutes).toBe(91);
  });
});

describe("files (storage faked)", () => {
  it("runs request -> upload -> confirm -> download -> delete with authorization at every step", async () => {
    const req = await files.requestUpload(
      staffA,
      { clientId, projectId, filename: "../../My Report (1).pdf", size: 1234, mime: "application/pdf" },
      fakeStorage,
    );
    const row = await db.fileAsset.findUniqueOrThrow({ where: { id: req.fileId } });
    expect(row.status).toBe("PENDING");
    expect(row.name).toBe("My Report (1).pdf");
    expect(row.storageKey.startsWith(`clients/${clientId}/${projectId}/`)).toBe(true);
    // Not uploaded yet: confirm fails and file is not downloadable.
    await expect(files.confirmUpload(staffA, req.fileId, fakeStorage)).rejects.toBeInstanceOf(ZodError);
    await expect(files.getDownloadUrl(staffA, req.fileId, fakeStorage)).rejects.toBeInstanceOf(NotFoundError);
    mem.set(row.storageKey, 1234);
    await files.confirmUpload(staffA, req.fileId, fakeStorage);
    expect((await files.listFiles(staffA, { projectId })).map((f) => f.id)).toContain(req.fileId);
    expect(await files.getDownloadUrl(staffA, req.fileId, fakeStorage)).toContain("download.test");
    // Staff B (not a member) cannot see or fetch it; another user cannot confirm someone else's upload.
    await expect(files.getDownloadUrl(staffB, req.fileId, fakeStorage)).rejects.toBeInstanceOf(NotFoundError);
    expect(await files.listFiles(staffB, { projectId })).toEqual([]);
    await expect(files.deleteFile(staffB, req.fileId, fakeStorage)).rejects.toBeInstanceOf(NotFoundError);
    await files.deleteFile(staffA, req.fileId, fakeStorage);
    expect(mem.has(row.storageKey)).toBe(false);
    expect(await db.fileAsset.count({ where: { id: req.fileId } })).toBe(0);
  });

  it("rejects dangerous types, oversize files, size mismatch, and unauthorized targets", async () => {
    const base = { clientId, projectId, mime: "application/octet-stream" };
    await expect(
      files.requestUpload(staffA, { ...base, filename: "run.exe", size: 10 }, fakeStorage),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      files.requestUpload(staffA, { ...base, filename: "page.html", size: 10 }, fakeStorage),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      files.requestUpload(staffA, { ...base, filename: "big.zip", size: 101 * 1024 * 1024 }, fakeStorage),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      files.requestUpload(staffB, { ...base, filename: "a.pdf", size: 10 }, fakeStorage),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Client-level (no project) files are admin-only.
    await expect(
      files.requestUpload(staffA, { clientId, filename: "a.pdf", size: 10, mime: "application/pdf" }, fakeStorage),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await files.requestUpload(
      admin,
      { clientId, filename: "a.pdf", size: 10, mime: "application/pdf" },
      fakeStorage,
    );
    const row = await db.fileAsset.findUniqueOrThrow({ where: { id: ok.fileId } });
    mem.set(row.storageKey, 999); // wrong size
    await expect(files.confirmUpload(admin, ok.fileId, fakeStorage)).rejects.toBeInstanceOf(ZodError);
    expect(await db.fileAsset.count({ where: { id: ok.fileId } })).toBe(0);
    expect(mem.has(row.storageKey)).toBe(false);
  });

  it("safeFilename strips paths and odd characters", () => {
    expect(files.safeFilename("C:\\evil\\..\\x y.pdf")).toBe("x y.pdf");
    expect(files.safeFilename("a<b>|c.txt")).toBe("a_b__c.txt");
  });
});
