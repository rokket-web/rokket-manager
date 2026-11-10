import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import { setMailerForTests, type MailMessage } from "@/server/mail";
import { deleteClient } from "./clients";
import { getPortalAccess, inviteClientUser, resendPortalInvite, setPortalActive } from "./portal-access";

const P = `zztest-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL = `${P}@client.test`;
let admin: ActorLike;
let staff: ActorLike;
let clientId: string;
const sent: MailMessage[] = [];

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  const s = await db.user.findUniqueOrThrow({ where: { email: "staff@rokket.test" } });
  admin = { id: a.id, role: "ADMIN" };
  staff = { id: s.id, role: "STAFF" };
  clientId = (await db.client.create({ data: { name: `${P} Client` } })).id;
});
beforeEach(() => {
  sent.length = 0;
  setMailerForTests({ send: async (m) => void sent.push(m) });
});
afterAll(async () => {
  setMailerForTests(undefined);
  await db.user.deleteMany({ where: { email: { startsWith: P } } });
  await db.activity.deleteMany({ where: { clientId } });
  await db.client.deleteMany({ where: { id: clientId } });
  await db.$disconnect();
});

describe("portal invites", () => {
  it("only admins can manage portal access", async () => {
    await expect(inviteClientUser(staff, clientId, { name: "x", email: EMAIL })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPortalAccess(staff, clientId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPortalActive(staff, clientId, false)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates input", async () => {
    await expect(inviteClientUser(admin, clientId, { name: "", email: "nope" })).rejects.toBeInstanceOf(ZodError);
  });

  it("creates a CLIENT user bound to the client and emails a sign-in link", async () => {
    const r = await inviteClientUser(admin, clientId, { name: "Pat Client", email: EMAIL.toUpperCase() });
    expect(r.sent).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { clientId } });
    expect(u).toMatchObject({ email: EMAIL, role: "CLIENT", active: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    expect(sent[0].subject).toMatch(/invited/);
    expect(sent[0].text).toMatch(/\/api\/auth\/magic-link\/verify\?token=/);
    expect(sent[0].text).toMatch(/expires in 1 hour/);
  });

  it("the emailed link signs the client in, once", async () => {
    await resendPortalInvite(admin, clientId);
    const url = sent[0].text.match(/https?:\/\/\S+magic-link\/verify\?\S+/)![0];
    const first = await auth.handler(new Request(url, { redirect: "manual" }));
    expect([302, 307]).toContain(first.status);
    expect(first.headers.get("set-cookie")).toMatch(/session_token/);
    const user = await db.user.findUniqueOrThrow({ where: { clientId } });
    expect(await db.session.count({ where: { userId: user.id } })).toBeGreaterThan(0);
    const again = await auth.handler(new Request(url, { redirect: "manual" }));
    expect(again.headers.get("set-cookie") ?? "").not.toMatch(/session_token=[^;]+;/);
  });

  it("allows only one portal user per client and no email reuse", async () => {
    await expect(inviteClientUser(admin, clientId, { name: "B", email: `${P}-b@client.test` })).rejects.toBeInstanceOf(ConflictError);
    const other = (await db.client.create({ data: { name: `${P} Other` } })).id;
    await expect(inviteClientUser(admin, other, { name: "B", email: EMAIL })).rejects.toBeInstanceOf(ConflictError);
    await db.client.delete({ where: { id: other } });
  });

  it("never emails staff or admin accounts, or unknown addresses", async () => {
    for (const email of ["admin@rokket.test", "staff@rokket.test", `${P}-nobody@client.test`]) {
      await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() }).catch(() => undefined);
    }
    expect(sent).toHaveLength(0);
  });

  it("turning access off ends sessions and stops emails; restoring brings it back", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { clientId } });
    expect(await db.session.count({ where: { userId: user.id } })).toBeGreaterThan(0);
    await setPortalActive(admin, clientId, false);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    await expect(resendPortalInvite(admin, clientId)).rejects.toBeInstanceOf(ConflictError);
    await auth.api.signInMagicLink({ body: { email: EMAIL, callbackURL: "/" }, headers: new Headers() }).catch(() => undefined);
    expect(sent).toHaveLength(0);
    await setPortalActive(admin, clientId, true);
    expect((await resendPortalInvite(admin, clientId)).sent).toBe(true);
  });

  it("reports a send failure but keeps the user so Resend can recover", async () => {
    const c2 = (await db.client.create({ data: { name: `${P} Two` } })).id;
    setMailerForTests({ send: async () => { throw new Error("boom"); } });
    const r = await inviteClientUser(admin, c2, { name: "Two", email: `${P}-two@client.test` });
    expect(r.sent).toBe(false);
    expect(r.error).toMatch(/Resend/);
    expect(await db.user.findUnique({ where: { clientId: c2 } })).not.toBeNull();
    await deleteClient(admin, c2);
    expect(await db.user.count({ where: { email: `${P}-two@client.test` } })).toBe(0); // portal user removed with the client
  });
});
