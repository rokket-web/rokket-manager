import { createHmac, timingSafeEqual } from "node:crypto";

export class MailgunWebhookError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "MailgunWebhookError";
  }
}

const MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Mailgun signs `timestamp + token` with the HTTP webhook signing key (HMAC-SHA256, hex).
 * Stale timestamps are rejected so a captured request cannot be replayed much later.
 */
export function verifyMailgunSignature(
  sig: { timestamp?: unknown; token?: unknown; signature?: unknown } | null | undefined,
  key: string | undefined,
  nowMs: number = Date.now(),
): void {
  if (!key) throw new MailgunWebhookError("Mailgun webhook signing key is not configured.", 503);
  const { timestamp, token, signature } = sig ?? {};
  if (typeof timestamp !== "string" || typeof token !== "string" || typeof signature !== "string") {
    throw new MailgunWebhookError("Missing signature.", 401);
  }
  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > MAX_AGE_MS) throw new MailgunWebhookError("Stale signature.", 401);
  const expected = createHmac("sha256", key).update(timestamp + token).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new MailgunWebhookError("Invalid signature.", 401);
}
