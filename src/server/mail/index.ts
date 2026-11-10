import { z } from "zod";

export type MailAttachment = { filename: string; content: Uint8Array; contentType: string };
export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
  attachments?: MailAttachment[];
};
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured. Set the Mailgun environment variables.");
    this.name = "MailNotConfiguredError";
  }
}
export class MailDeliveryError extends Error {
  constructor(status: number) {
    super(`The email provider rejected the message (HTTP ${status}).`);
    this.name = "MailDeliveryError";
  }
}

const noCrlf = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function createMailgunMailer(cfg: { apiKey: string; domain: string; from: string }, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(msg) {
      const form = new FormData();
      form.set("from", noCrlf(cfg.from));
      form.set("to", noCrlf(msg.to));
      form.set("subject", noCrlf(msg.subject));
      form.set("text", msg.text);
      if (msg.html) form.set("html", msg.html);
      if (msg.replyTo) form.set("h:Reply-To", noCrlf(msg.replyTo));
      for (const a of msg.attachments ?? []) {
        form.append("attachment", new Blob([a.content as BlobPart], { type: a.contentType }), noCrlf(a.filename));
      }
      const res = await fetchImpl(`https://api.mailgun.net/v3/${cfg.domain}/messages`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`api:${cfg.apiKey}`).toString("base64")}` },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      // Never include the response body or key in errors/logs.
      if (!res.ok) throw new MailDeliveryError(res.status);
    },
  };
}

const configSchema = z.object({
  MAILGUN_API_KEY: z.string().min(1),
  MAILGUN_DOMAIN: z.string().regex(/^[a-z0-9.-]+$/i),
  MAIL_FROM: z.string().min(3),
});

let override: Mailer | undefined;
/** Tests inject a fake. Pass undefined to restore the real mailer. */
export function setMailerForTests(m: Mailer | undefined) {
  override = m;
}

/** Dev/e2e only: logs recipient, subject and attachment names (never bodies), sends nothing. */
const logMailer: Mailer = {
  async send(msg) {
    console.info(`[mail:log] to=${msg.to} subject=${JSON.stringify(msg.subject)} attachments=${(msg.attachments ?? []).map((a) => a.filename).join(",")}`);
  },
};

/** The configured mailer, or MailNotConfiguredError. */
export function getMailer(): Mailer {
  if (override) return override;
  if (process.env.MAIL_DRIVER === "log" && process.env.NODE_ENV !== "production") return logMailer;
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) throw new MailNotConfiguredError();
  return createMailgunMailer({
    apiKey: parsed.data.MAILGUN_API_KEY,
    domain: parsed.data.MAILGUN_DOMAIN,
    from: parsed.data.MAIL_FROM,
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
