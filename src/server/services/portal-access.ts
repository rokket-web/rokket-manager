import { z } from "zod";
import { audit } from "@/server/audit";
import { auth } from "@/server/auth";
import { assertCan, type ActorLike } from "@/server/authz/clients";
import { db, withRetry } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .pipe(z.email("Enter a valid email"))
    .transform((v) => v.toLowerCase()),
});

export type InviteResult = { sent: boolean; error?: string };

const SEND_FAILED = "The portal user was saved but the email could not be sent. Use Resend invite.";

async function sendLink(email: string, headers: Headers): Promise<InviteResult> {
  try {
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/portal?invited=1" }, headers });
    return { sent: true };
  } catch (e) {
    console.error("[portal invite]", e instanceof Error ? e.name : e);
    return { sent: false, error: SEND_FAILED };
  }
}

/** The client's portal user (one per client), if any. */
export async function getPortalAccess(actor: ActorLike, clientId: string) {
  assertCan(actor, "client:write");
  return withRetry(() =>
    db.user.findUnique({
      where: { clientId },
      select: { id: true, name: true, email: true, active: true, createdAt: true, _count: { select: { sessions: true } } },
    }),
  );
}

export async function inviteClientUser(actor: ActorLike, clientId: string, raw: unknown, headers = new Headers()) {
  assertCan(actor, "client:write");
  const input = inviteSchema.parse(raw);
  await db.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId }, select: { name: true } });
    if (!client) throw new NotFoundError("Client not found.");
    if (await tx.user.findUnique({ where: { clientId }, select: { id: true } })) {
      throw new ConflictError("This client already has portal access.");
    }
    if (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      throw new ConflictError("That email already belongs to another user.");
    }
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, role: "CLIENT", clientId, emailVerified: false },
    });
    await tx.activity.create({
      data: { clientId, actorId: actor.id, type: "portal.invited", summary: `Portal access granted to ${input.email}` },
    });
    await audit({ actorId: actor.id, action: "portal.invite", entity: "User", entityId: user.id, meta: { clientId } }, tx);
  });
  return sendLink(input.email, headers);
}

export async function resendPortalInvite(actor: ActorLike, clientId: string, headers = new Headers()) {
  assertCan(actor, "client:write");
  const user = await db.user.findUnique({ where: { clientId }, select: { id: true, email: true, active: true } });
  if (!user) throw new NotFoundError("This client has no portal user yet.");
  if (!user.active) throw new ConflictError("Portal access is turned off. Turn it on first.");
  const r = await sendLink(user.email, headers);
  await audit({ actorId: actor.id, action: "portal.invite.resend", entity: "User", entityId: user.id, meta: { sent: r.sent } });
  return r;
}

/** Turning access off also ends every session immediately. */
export async function setPortalActive(actor: ActorLike, clientId: string, active: boolean) {
  assertCan(actor, "client:write");
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { clientId }, select: { id: true, email: true, active: true } });
    if (!user) throw new NotFoundError("This client has no portal user yet.");
    if (user.active === active) return;
    await tx.user.update({ where: { id: user.id }, data: { active } });
    if (!active) await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.activity.create({
      data: { clientId, actorId: actor.id, type: active ? "portal.enabled" : "portal.disabled", summary: `Portal access ${active ? "restored" : "turned off"} for ${user.email}` },
    });
    await audit({ actorId: actor.id, action: active ? "portal.enable" : "portal.disable", entity: "User", entityId: user.id }, tx);
  });
}
