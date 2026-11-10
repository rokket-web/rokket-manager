import { NextResponse } from "next/server";
import { parseMailgunEvent } from "@/lib/email-events";
import { MailgunWebhookError, verifyMailgunSignature } from "@/server/mailgun-webhook";
import { applyMailgunEvent } from "@/server/services/email-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mailgun event webhook (delivered, permanent failure, spam complaint). The HMAC signature is verified before anything
 * touches the database. Events we do not act on, or for emails we did not log, still get a 200 so Mailgun stops retrying.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 100_000) return new NextResponse("Payload too large", { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  try {
    verifyMailgunSignature((payload as { signature?: never } | null)?.signature, process.env.MAILGUN_WEBHOOK_SIGNING_KEY);
  } catch (e) {
    if (e instanceof MailgunWebhookError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  const evt = parseMailgunEvent(payload);
  if (!evt) return NextResponse.json({ received: true, outcome: "ignored" });
  try {
    return NextResponse.json({ received: true, outcome: await applyMailgunEvent(evt) });
  } catch (e) {
    console.error("[mailgun webhook]", evt.event, e instanceof Error ? e.name : e);
    return new NextResponse("Processing failed", { status: 500 }); // Mailgun retries
  }
}
