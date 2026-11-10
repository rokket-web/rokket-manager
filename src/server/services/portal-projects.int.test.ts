import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import * as portal from "./portal";
import * as sharing from "./portal-sharing";

const P = `ZZTEST-${Math.random().toString(36).slice(2, 8)}`;
let admin: ActorLike;
let staffMember: ActorLike; // staff who IS a member of the project: still cannot share
let A: ActorLike;
let B: ActorLike;
let clientA: string;
let clientB: string;
let proj: string; // client A's project
let projB: string; // client B's project
let mShared: string;
let mHidden: string;
let tShared: string; // under the shared milestone
let tOrphan: string; // shared, but its milestone is hidden
let tHidden: string;
let userIds: string[] = [];

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  const s = await db.user.findUniqueOrThrow({ where: { email: "staff@rokket.test" } });
  admin = { id: a.id, role: "ADMIN" };
  staffMember = { id: s.id, role: "STAFF" };
  clientA = (await db.client.create({ data: { name: `${P} A` } })).id;
  clientB = (await db.client.create({ data: { name: `${P} B` } })).id;
  const ua = await db.user.create({ data: { name: "Pat A", email: `${P.toLowerCase()}-a@c.test`, role: "CLIENT", clientId: clientA } });
  const ub = await db.user.create({ data: { name: "Bo B", email: `${P.toLowerCase()}-b@c.test`, role: "CLIENT", clientId: clientB } });
  userIds = [ua.id, ub.id];
  A = { id: ua.id, role: "CLIENT", clientId: clientA };
  B = { id: ub.id, role: "CLIENT", clientId: clientB };

  proj = (
    await db.project.create({
      data: {
        clientId: clientA,
        name: `${P} Site`,
        description: "Public description",
        status: "ACTIVE",
        budgetCents: 987654,
        hourlyRateCents: 12345,
        members: { create: { userId: s.id } },
      },
    })
  ).id;
  projB = (await db.project.create({ data: { clientId: clientB, name: `${P} B Project`, visibleToClient: true } })).id;
  mShared = (await db.milestone.create({ data: { projectId: proj, title: "Design", status: "COMPLETED", billableCents: 765432 } })).id;
  mHidden = (await db.milestone.create({ data: { projectId: proj, title: "Secret milestone", billableCents: 1 } })).id;
  tShared = (await db.task.create({ data: { projectId: proj, milestoneId: mShared, title: "Mockups", status: "DONE", priority: "URGENT", assigneeId: s.id } })).id;
  tOrphan = (await db.task.create({ data: { projectId: proj, milestoneId: mHidden, title: "Orphan task", status: "TODO" } })).id;
  tHidden = (await db.task.create({ data: { projectId: proj, title: "Internal only task", description: "internal" } })).id;
  await db.taskComment.create({ data: { taskId: tShared, authorId: s.id, body: "SECRET-COMMENT", visibleToClient: false } });
  await db.timeEntry.create({ data: { projectId: proj, userId: s.id, startedAt: new Date(), endedAt: new Date(), minutes: 4321, rateCents: 12345 } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: { in: [proj, projB] } } });
  await db.timeEntry.deleteMany({ where: { projectId: { in: [proj, projB] } } });
  await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  await db.activity.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  await db.$disconnect();
});

describe("sharing controls", () => {
  it("only admins can see or change sharing, even staff on the project", async () => {
    await expect(sharing.getSharingOverview(staffMember, proj)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sharing.setProjectVisibility(staffMember, proj, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sharing.setItemsVisibility(staffMember, proj, "task", null, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sharing.setProjectVisibility(A, proj, true)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.project.findUniqueOrThrow({ where: { id: proj } })).visibleToClient).toBe(false);
  });

  it("everything starts hidden", async () => {
    const o = await sharing.getSharingOverview(admin, proj);
    expect(o.visibleToClient).toBe(false);
    expect([...o.milestones, ...o.tasks].every((x) => !x.visibleToClient)).toBe(true);
    expect(o.client.portalUser).toEqual({ active: true }); // the admin tab uses this to warn when a client has no portal user
  });

  it("toggles single items and bulk, audits each change, and ignores ids from other projects", async () => {
    await sharing.setProjectVisibility(admin, proj, true);
    expect(await sharing.setItemsVisibility(admin, proj, "milestone", [mShared], true)).toBe(1);
    expect(await sharing.setItemsVisibility(admin, proj, "task", [tShared, tOrphan], true)).toBe(2);
    const foreign = (await db.task.create({ data: { projectId: projB, title: "B task" } })).id;
    expect(await sharing.setItemsVisibility(admin, proj, "task", [foreign], true)).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: foreign } })).visibleToClient).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: proj, action: { in: ["project.share", "project.share.items"] } } })).toBe(4);
    await expect(sharing.setProjectVisibility(admin, "nope", true)).rejects.toBeInstanceOf(NotFoundError);
    // bulk
    expect(await sharing.setItemsVisibility(admin, proj, "task", null, false)).toBe(3);
    expect(await sharing.setItemsVisibility(admin, proj, "task", [tShared, tOrphan], true)).toBe(2);
  });
});

describe("what the client sees", () => {
  it("shows only the shared project, milestone and tasks, and counts progress over shared items", async () => {
    const list = await portal.listPortalProjects(A);
    expect(list.map((p) => p.id)).toEqual([proj]);
    expect(list[0].progressPercent).toBe(67); // shared: milestone(done) + mockups(done) + orphan(todo) = 2/3
    const p = await portal.getPortalProject(A, proj);
    expect(p.milestones.map((m) => m.title)).toEqual(["Design"]);
    expect(p.tasks.map((t) => t.title).sort()).toEqual(["Mockups", "Orphan task"]);
    // a shared task under a hidden milestone is listed, but detached from it (the milestone's existence is not revealed)
    expect(p.tasks.find((t) => t.id === tOrphan)!.milestoneId).toBeNull();
    expect(p.tasks.find((t) => t.id === tShared)!.milestoneId).toBe(mShared);
  });

  it("never exposes budgets, rates, billable amounts, time, team, comments, priority or hidden items", async () => {
    const json = JSON.stringify(await portal.getPortalProject(A, proj)) + JSON.stringify(await portal.listPortalProjects(A));
    for (const secret of ["987654", "12345", "765432", "4321", "SECRET-COMMENT", "Secret milestone", "Internal only task", "Sam Staff", "URGENT", "assignee", "budget", "hourly", "billable"]) {
      expect(json.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(json).not.toContain(tHidden);
    expect(json).not.toContain(mHidden);
  });

  it("another client's project, and this client's hidden items, are plain not-found", async () => {
    await expect(portal.getPortalProject(B, proj)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.getPortalProject(A, projB)).rejects.toBeInstanceOf(NotFoundError);
    expect((await portal.listPortalProjects(B)).map((p) => p.id)).toEqual([projB]);
  });

  it("hiding the project hides everything beneath it, and sharing again restores the item choices", async () => {
    await sharing.setProjectVisibility(admin, proj, false);
    await expect(portal.getPortalProject(A, proj)).rejects.toBeInstanceOf(NotFoundError);
    expect(await portal.listPortalProjects(A)).toEqual([]);
    expect((await portal.getPortalProject({ ...B }, projB)).id).toBe(projB); // unaffected
    await sharing.setProjectVisibility(admin, proj, true);
    expect((await portal.getPortalProject(A, proj)).tasks).toHaveLength(2);
  });

  it("is forbidden to staff, admin and unlinked users, and counts active shared projects on the overview", async () => {
    for (const who of [staffMember, admin, { id: "u", role: "CLIENT", clientId: null } as ActorLike]) {
      await expect(portal.listPortalProjects(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(portal.getPortalProject(who, proj)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await portal.getPortalSummary(A)).sharedProjects).toBe(1);
    await db.project.update({ where: { id: proj }, data: { status: "COMPLETED" } });
    expect((await portal.getPortalSummary(A)).sharedProjects).toBe(0); // completed projects stop counting as active
    expect((await portal.listPortalProjects(A)).map((p) => p.id)).toEqual([proj]); // but remain viewable
  });
});
