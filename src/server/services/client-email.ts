import { audit } from "@/server/audit";
import { assertCan, type ActorLike } from "@/server/authz/clients";
import { db } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";
import { MailNotConfiguredError, getMailer } from "@/server/mail";
import { paragraphsHtml } from "@/server/mail/html";
import { clientEmailInputSchema } from "@/lib/validation/messages";
import { resolveRecipient } from "./billing-core";
import { readCompanyProfile } from "./settings";

const MAX_EMAILS_PER_HOUR = 30;

/** Where an email to this client would go (billing email, client email, then primary contact). */
export async function getClientEmailRecipient(actor: ActorLike, clientId: string): Promise<string | null> {
  assertCan(actor, "client:write");
  return resolveRecipient(clientId);
}

/** Admin writes a free-form email to a client. Logged on the client timeline and in the audit log. */
export async function sendClientEmail(actor: ActorLike, clientId: string, raw: unknown): Promise<{ to: string }> {
  assertCan(actor, "client:write");
  const { subject, body } = clientEmailInputSchema.parse(raw);
  const client = await db.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) throw new NotFoundError("Client not found.");
  const to = await resolveRecipient(clientId);
  if (!to) throw new ConflictError(`${client.name} has no email address. Add one on the client first.`);

  const recent = await db.auditLog.count({
    where: { actorId: actor.id, action: "client.email", createdAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recent >= MAX_EMAILS_PER_HOUR) throw new ConflictError("You have sent a lot of emails in the last hour. Please wait a little.");

  let mailer;
  try {
    mailer = getMailer();
  } catch (e) {
    if (e instanceof MailNotConfiguredError) throw new ConflictError("Email is not configured yet, so nothing was sent.");
    throw e;
  }
  const company = await readCompanyProfile();
  const lines = [...body.split(/\r?\n/), "", company.name];
  try {
    await mailer.send({ to, subject, text: lines.join("\n"), html: paragraphsHtml(lines), replyTo: company.email });
  } catch (e) {
    console.error("[client email]", e instanceof Error ? e.name : e);
    throw new ConflictError("The email could not be sent. Please try again.");
  }
  await db.$transaction(async (tx) => {
    await tx.activity.create({ data: { clientId, actorId: actor.id, type: "email.sent", summary: `Emailed ${to}: ${subject}` } });
    await audit({ actorId: actor.id, action: "client.email", entity: "Client", entityId: clientId, meta: { to, subject } }, tx);
  });
  return { to };
}
