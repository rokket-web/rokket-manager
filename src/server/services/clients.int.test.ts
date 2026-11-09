import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import * as svc from "./clients";

const P = `ZZTEST-${Math.random().toString(36).slice(2, 8)}`;
let admin: ActorLike;
const staff: ActorLike = { id: "staff-x", role: "STAFF" };
const portal: ActorLike = { id: "client-x", role: "CLIENT", clientId: "whatever" };
const ids: string[] = [];

async function mk(name: string, extra: Record<string, string> = {}) {
  const c = await svc.createClient(admin, { name: `${P} ${name}`, ...extra });
  ids.push(c.id);
  return c;
}

beforeAll(async () => {
  const u = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  admin = { id: u.id, role: "ADMIN" };
});

afterAll(async () => {
  await db.client.deleteMany({ where: { name: { contains: P } } });
  await db.tag.deleteMany({ where: { name: { startsWith: "zztag" }, clients: { none: {} } } });
  await db.$disconnect();
});

describe("create / read / update / delete", () => {
  it("creates with tax bps, normalized tags, activity and audit rows", async () => {
    const c = await mk("Alpha", {
      status: "ACTIVE",
      taxRate: "8.25",
      tags: "ZZTag-One, zztag-two",
      email: "A@Example.com",
    });
    expect(c.taxRateBps).toBe(825);
    expect(c.email).toBe("a@example.com");
    const full = await svc.getClient(admin, c.id);
    expect(full.tagNames.sort()).toEqual(["zztag-one", "zztag-two"]);
    expect(full.activities.map((a) => a.type)).toContain("client.created");
    expect(await db.auditLog.count({ where: { entity: "Client", entityId: c.id, action: "client.create" } })).toBe(1);
  });

  it("validates input", async () => {
    await expect(svc.createClient(admin, { name: "" })).rejects.toBeInstanceOf(ZodError);
    await expect(svc.createClient(admin, { name: `${P} bad`, taxRate: "abc" })).rejects.toBeInstanceOf(ZodError);
    await expect(svc.createClient(admin, { name: `${P} bad`, email: "nope" })).rejects.toBeInstanceOf(ZodError);
    expect(await db.client.count({ where: { name: `${P} bad` } })).toBe(0);
  });

  it("updates, records status change, and blank tax means default", async () => {
    const c = await mk("Bravo", { taxRate: "6" });
    await svc.updateClient(admin, c.id, { name: `${P} Bravo2`, status: "PAST", taxRate: "", tags: "zztag-x" });
    const full = await svc.getClient(admin, c.id);
    expect(full.name).toBe(`${P} Bravo2`);
    expect(full.taxRateBps).toBeNull();
    expect(full.activities.map((a) => a.type)).toEqual(
      expect.arrayContaining(["client.status_changed", "client.tax_changed"]),
    );
    expect(full.tagNames).toEqual(["zztag-x"]);
  });

  it("deletes and cascades", async () => {
    const c = await mk("Charlie");
    await svc.addContact(admin, c.id, { firstName: "A" });
    await svc.addNote(admin, c.id, { body: "x" });
    await svc.deleteClient(admin, c.id);
    await expect(svc.getClient(admin, c.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.contact.count({ where: { clientId: c.id } })).toBe(0);
    expect(await db.note.count({ where: { clientId: c.id } })).toBe(0);
  });
});

describe("contacts and notes", () => {
  it("first contact is primary and only one primary exists", async () => {
    const c = await mk("Delta");
    const a = await svc.addContact(admin, c.id, { firstName: "Ann", lastName: "A" });
    const b = await svc.addContact(admin, c.id, { firstName: "Bob", lastName: "B", isPrimary: "true" });
    expect(a.isPrimary).toBe(true);
    const contacts = await db.contact.findMany({ where: { clientId: c.id } });
    expect(contacts.filter((x) => x.isPrimary).map((x) => x.id)).toEqual([b.id]);
    await svc.updateContact(admin, a.id, { firstName: "Ann", isPrimary: "true" });
    expect((await db.contact.findMany({ where: { clientId: c.id, isPrimary: true } })).map((x) => x.id)).toEqual([
      a.id,
    ]);
    await svc.deleteContact(admin, b.id);
    expect(await db.contact.count({ where: { clientId: c.id } })).toBe(1);
  });

  it("adds and removes notes and logs them on the timeline", async () => {
    const c = await mk("Echo");
    const n = await svc.addNote(admin, c.id, { body: "  hello  " });
    expect(n.body).toBe("hello");
    await expect(svc.addNote(admin, c.id, { body: "   " })).rejects.toBeInstanceOf(ZodError);
    expect((await svc.getClient(admin, c.id)).activities.map((a) => a.type)).toContain("note.added");
    await svc.deleteNote(admin, n.id);
    expect(await db.note.count({ where: { clientId: c.id } })).toBe(0);
  });
});

describe("search, filter, pagination", () => {
  it("filters by text, status, tag and paginates", async () => {
    const a = await mk("Search One", { status: "ACTIVE", tags: "zztag-s" });
    await mk("Search Two", { status: "LEAD", tags: "zztag-s" });
    await mk("Search Three", { status: "LEAD" });
    await svc.addContact(admin, a.id, { firstName: "Zed", email: `zed.${P.toLowerCase()}@find.example` });

    const byText = await svc.listClients(admin, { q: `${P} search` });
    expect(byText.total).toBe(3);
    const byContact = await svc.listClients(admin, { q: `zed.${P.toLowerCase()}` });
    expect(byContact.items.map((i) => i.id)).toEqual([a.id]);
    expect((await svc.listClients(admin, { q: `${P} search`, status: "LEAD" })).total).toBe(2);
    expect((await svc.listClients(admin, { q: P, tag: "zztag-s" })).total).toBe(2);

    const p1 = await svc.listClients(admin, { q: `${P} search`, pageSize: 2, page: 1 });
    const p2 = await svc.listClients(admin, { q: `${P} search`, pageSize: 2, page: 2 });
    expect([p1.items.length, p2.items.length, p1.pageCount]).toEqual([2, 1, 2]);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(3);
  });

  it("is safe against wildcard / injection-looking search text", async () => {
    const r = await svc.listClients(admin, { q: '\'; DROP TABLE "Client"; --' });
    expect(r.total).toBe(0);
    expect(await db.client.count()).toBeGreaterThan(0);
  });
});

describe("permissions", () => {
  it("staff cannot write, delete, import or export", async () => {
    const c = await mk("Perm");
    await expect(svc.createClient(staff, { name: `${P} no` })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.updateClient(staff, c.id, { name: `${P} hacked` })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.setClientStatus(staff, c.id, "PAST")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.deleteClient(staff, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.addContact(staff, c.id, { firstName: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.addNote(staff, c.id, { body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.importClientsCsv(staff, "name\nX")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.exportClientsCsv(staff)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.client.findUniqueOrThrow({ where: { id: c.id } })).name).toBe(`${P} Perm`);
  });

  it("staff only see clients in scope (none until project assignment exists)", async () => {
    const c = await mk("Hidden");
    expect((await svc.listClients(staff, { q: P })).total).toBe(0);
    await expect(svc.getClient(staff, c.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc.listPipeline(staff)).LEAD).toEqual([]);
  });

  it("portal client users cannot use any internal client service", async () => {
    const c = await mk("PortalProbe");
    await expect(svc.listClients(portal, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.getClient(portal, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.listPipeline(portal)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.deleteClient(portal, c.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("CSV import / export", () => {
  it("exports (injection-safe) and imports with duplicate skipping and row errors", async () => {
    await mk("Existing");
    const csv = [
      "name,status,email,tax_rate_percent,tags",
      `${P} Existing,ACTIVE,,,`,
      `${P} Imported A,active,ia@example.com,8.25,"zztag-i, zztag-j"`,
      `${P} Imported A,lead,,,`,
      `${P} Bad Email,lead,not-an-email,,`,
      `${P} Bad Tax,lead,,abc,`,
      `=${P} Formula,lead,,,`,
    ].join("\n");
    const res = await svc.importClientsCsv(admin, csv);
    expect(res.created).toBe(2); // Imported A + the formula-looking name (valid text)
    expect(res.skipped).toBe(2); // existing + in-file duplicate
    expect(res.errors.map((e) => e.row)).toEqual([5, 6]);
    const a = await db.client.findFirstOrThrow({ where: { name: `${P} Imported A` } });
    ids.push(a.id);
    expect(a.taxRateBps).toBe(825);
    const evil = await db.client.findFirstOrThrow({ where: { name: `=${P} Formula` } });
    ids.push(evil.id);

    const out = await svc.exportClientsCsv(admin);
    expect(out).toContain(`${P} Imported A`);
    expect(out).toContain(`'=${P} Formula`); // formula neutralized on export
    expect(out.split("\r\n")[0]).toBe(
      "name,status,website,industry,email,phone,address_line1,address_line2,city,state,postal_code,country,billing_email,tax_rate_percent,tags",
    );
  });

  it("rejects files without a name column and writes no rows", async () => {
    const before = await db.client.count();
    const res = await svc.importClientsCsv(admin, "email\na@b.co");
    expect(res.fatal).toMatch(/name/);
    expect(await db.client.count()).toBe(before);
  });
});

describe("seed data", () => {
  it("has about 20 seeded clients", async () => {
    expect(await db.client.count({ where: { NOT: { name: { startsWith: "ZZTEST" } } } })).toBeGreaterThanOrEqual(20);
  });
});
