import { db } from "@/server/db";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export type EmailLogEntry = {
  kind: string;
  clientId: string | null;
  triggeredById: string | null;
  to: string;
  subject: string;
  status: "SENT" | "FAILED";
  detail?: string | null;
  providerId?: string | null;
};

/** One row per outgoing email. Stores the subject and recipient only, never the body or attachments. */
export async function recordEmail(e: EmailLogEntry): Promise<void> {
  await db.emailLog.create({
    data: {
      kind: clip(e.kind, 40),
      clientId: e.clientId,
      triggeredById: e.triggeredById,
      toEmail: clip(e.to, 320),
      subject: clip(e.subject, 300),
      status: e.status,
      detail: e.detail ? clip(e.detail, 300) : null,
      providerId: e.providerId ? e.providerId.replace(/^<|>$/g, "") : null,
    },
  });
}
