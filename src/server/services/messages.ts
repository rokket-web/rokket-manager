import { audit } from "@/server/audit";
import { assertCan, type ActorLike } from "@/server/authz/clients";
import { portalClientId } from "@/server/authz/portal";
import { appBaseUrl } from "@/server/app-url";
import { db, withRetry } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";
import { MailNotConfiguredError, getMailer } from "@/server/mail";
import { paragraphsHtml } from "@/server/mail/html";
import { messageInputSchema } from "@/lib/validation/messages";
import { readCompanyProfile } from "./settings";

/** Cheap abuse guard: one side cannot post more than this many messages in an hour. */
export const MAX_MESSAGES_PER_HOUR = 20;
const THREAD_LIMIT = 200;

async function assertUnderRateLimit(clientId: string, fromClient: boolean) {
  const recent = await db.message.count({
    where: { clientId, fromClient, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recent >= MAX_MESSAGES_PER_HOUR) {
    throw new ConflictError("You are sending messages too quickly. Please wait a little and try again.");
  }
}

async function authorNames(ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return {};
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

// ---------- admin side ----------

async function requireClientName(clientId: string): Promise<string> {
  const c = await db.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!c) throw new NotFoundError("Client not found.");
  return c.name;
}

export async function getAdminThread(actor: ActorLike, clientId: string) {
  assertCan(actor, "client:write");
  await requireClientName(clientId);
  const [rows, portalUser] = await withRetry(() =>
    Promise.all([
      db.message.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: THREAD_LIMIT }),
      db.user.findFirst({ where: { clientId, role: "CLIENT", active: true }, select: { id: true } }),
    ]),
  );
  const messages = rows.reverse();
  const names = await authorNames(messages.map((m) => m.authorId));
  return { messages, names, hasPortalAccess: !!portalUser };
}

/** Marks everything the client sent as read by an admin. Called when an admin opens the thread. */
export async function markThreadReadByAdmin(actor: ActorLike, clientId: string) {
  assertCan(actor, "client:write");
  await db.message.updateMany({ where: { clientId, fromClient: true, readAt: null }, data: { readAt: new Date() } });
}

export async function unreadFromClientCount(actor: ActorLike, clientId?: string): Promise<number> {
  assertCan(actor, "client:write");
  return db.message.count({ where: { fromClient: true, readAt: null, ...(clientId ? { clientId } : {}) } });
}

export type SendMessageResult = { notified: boolean; note?: string };

export async function sendAdminMessage(actor: ActorLike, clientId: string, raw: unknown): Promise<SendMessageResult> {
  assertCan(actor, "client:write");
  const { body } = messageInputSchema.parse(raw);
  const clientName = await requireClientName(clientId);
  await assertUnderRateLimit(clientId, false);
  // Only email when the client has nothing earlier waiting, so a burst of messages is one notification.
  const alreadyUnread = await db.message.count({ where: { clientId, fromClient: false, readAt: null } });
  await db.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { clientId, authorId: actor.id, fromClient: false, body } });
    await tx.activity.create({
      data: { clientId, actorId: actor.id, type: "message.sent", summary: "Message sent to client in the portal" },
    });
    await audit({ actorId: actor.id, action: "message.send", entity: "Message", entityId: m.id }, tx);
  });
  if (alreadyUnread > 0) return { notified: false };

  const portalUser = await db.user.findFirst({
    where: { clientId, role: "CLIENT", active: true },
    select: { email: true, name: true },
  });
  if (!portalUser) {
    return { notified: false, note: `${clientName} has no active portal access, so they cannot see this message. Send an email instead.` };
  }
  const company = await readCompanyProfile();
  const sent = await trySend({
    to: portalUser.email,
    subject: `New message from ${company.name}`,
    lines: [
      `Hello ${portalUser.name},`,
      `${company.name} sent you a message in your client portal.`,
      `Read and reply: ${appBaseUrl()}/portal/messages`,
    ],
    replyTo: null,
  });
  return sent ? { notified: true } : { notified: false, note: "The message was saved, but the notification email could not be sent." };
}

// ---------- portal side (always scoped to the signed-in client) ----------

export async function getPortalThread(actor: ActorLike) {
  const clientId = portalClientId(actor);
  const rows = await withRetry(() =>
    db.message.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: THREAD_LIMIT,
      select: { id: true, fromClient: true, body: true, createdAt: true, authorId: true },
    }),
  );
  const messages = rows.reverse();
  const names = await authorNames(messages.filter((m) => !m.fromClient).map((m) => m.authorId));
  // Never expose internal user ids to the client: hand back display names only.
  return messages.map((m) => ({
    id: m.id,
    fromClient: m.fromClient,
    body: m.body,
    createdAt: m.createdAt,
    senderName: m.fromClient ? "You" : ((m.authorId && names[m.authorId]) || "Our team"),
  }));
}

export async function markPortalThreadRead(actor: ActorLike) {
  const clientId = portalClientId(actor);
  await db.message.updateMany({ where: { clientId, fromClient: false, readAt: null }, data: { readAt: new Date() } });
}

export async function portalUnreadCount(actor: ActorLike): Promise<number> {
  const clientId = portalClientId(actor);
  return db.message.count({ where: { clientId, fromClient: false, readAt: null } });
}

export async function sendPortalMessage(actor: ActorLike, raw: unknown): Promise<void> {
  const clientId = portalClientId(actor);
  const { body } = messageInputSchema.parse(raw);
  await assertUnderRateLimit(clientId, true);
  const alreadyUnread = await db.message.count({ where: { clientId, fromClient: true, readAt: null } });
  const client = await db.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) throw new NotFoundError("Not found.");
  await db.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { clientId, authorId: actor.id, fromClient: true, body } });
    await tx.activity.create({
      data: { clientId, actorId: actor.id, type: "message.received", summary: "Message received from client in the portal" },
    });
    await audit({ actorId: actor.id, action: "message.receive", entity: "Message", entityId: m.id }, tx);
  });
  if (alreadyUnread > 0) return;

  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { email: true, name: true } });
  for (const a of admins) {
    await trySend({
      to: a.email,
      subject: `New message from ${client.name}`,
      lines: [
        `Hello ${a.name},`,
        `${client.name} sent a message in the client portal.`,
        `Read and reply: ${appBaseUrl()}/clients/${clientId}?tab=messages`,
      ],
      replyTo: null,
    });
  }
}

/** Notification email: never includes the message text. Failures are logged, never thrown. */
async function trySend(m: { to: string; subject: string; lines: string[]; replyTo: string | null }): Promise<boolean> {
  try {
    await getMailer().send({
      to: m.to,
      subject: m.subject,
      text: m.lines.join("\n\n"),
      html: paragraphsHtml(m.lines),
      replyTo: m.replyTo,
    });
    return true;
  } catch (e) {
    if (!(e instanceof MailNotConfiguredError)) console.error("[message notification]", e instanceof Error ? e.name : e);
    return false;
  }
}
