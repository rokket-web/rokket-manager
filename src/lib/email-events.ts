export type EmailStatusValue = "SENT" | "DELIVERED" | "FAILED" | "BOUNCED" | "COMPLAINED";

const RANK: Record<EmailStatusValue, number> = { FAILED: 0, SENT: 1, DELIVERED: 2, BOUNCED: 3, COMPLAINED: 3 };

export const EMAIL_KINDS: Record<string, string> = {
  invoice: "Invoice",
  quote: "Quote",
  admin_email: "Email to client",
  message_notice: "Message notice (client)",
  admin_notice: "Message notice (admin)",
  portal_link: "Portal sign-in link",
  quote_response: "Quote response alert",
  other: "Other",
};

export function emailKindLabel(kind: string): string {
  return EMAIL_KINDS[kind] ?? kind;
}

/** Mailgun message ids arrive with or without angle brackets; store and compare them without. */
export function normalizeMessageId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const v = id.trim().replace(/^<|>$/g, "");
  return v.length > 0 && v.length <= 300 ? v : null;
}

export type MailgunEvent = { event: "delivered" | "bounced" | "complained"; messageId: string; reason: string | null };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Reduce a Mailgun webhook payload to what we act on. Returns null for events we ignore:
 * accepted/opened/clicked, temporary failures (Mailgun keeps retrying), and anything malformed.
 */
export function parseMailgunEvent(payload: unknown): MailgunEvent | null {
  const data = (payload as { "event-data"?: Record<string, unknown> } | null)?.["event-data"];
  if (!data || typeof data !== "object") return null;
  const messageId = normalizeMessageId((data.message as { headers?: Record<string, unknown> } | undefined)?.headers?.["message-id"]);
  if (!messageId) return null;
  const status = data["delivery-status"] as { message?: unknown; description?: unknown } | undefined;
  const reasonRaw = [status?.description, status?.message].find((x): x is string => typeof x === "string" && x.trim() !== "");
  const reason = reasonRaw ? clip(reasonRaw.replace(/\s+/g, " ").trim(), 300) : null;
  switch (data.event) {
    case "delivered":
      return { event: "delivered", messageId, reason: null };
    case "failed":
      return data.severity === "permanent" ? { event: "bounced", messageId, reason } : null;
    case "complained":
      return { event: "complained", messageId, reason: null };
    default:
      return null;
  }
}

/** Status only moves forward (webhooks arrive late and out of order). Returns null for "no change". */
export function nextEmailStatus(current: EmailStatusValue, event: MailgunEvent["event"]): EmailStatusValue | null {
  const target: EmailStatusValue = event === "delivered" ? "DELIVERED" : event === "bounced" ? "BOUNCED" : "COMPLAINED";
  if (current === "FAILED") return null; // we never got a provider id for these
  return RANK[target] > RANK[current] ? target : null;
}
