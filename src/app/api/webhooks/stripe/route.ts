import { NextResponse } from "next/server";
import { verifyStripeWebhook, WebhookError } from "@/server/stripe";
import { processStripeEvent } from "@/server/services/stripe-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe webhook. Signature is verified against the raw body; unsigned or tampered requests never reach the data layer. */
export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    event = verifyStripeWebhook(raw, req.headers.get("stripe-signature"));
  } catch (e) {
    if (e instanceof WebhookError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  try {
    const outcome = await processStripeEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // 500 makes Stripe retry; the event id is only recorded when processing commits.
    console.error("[stripe webhook]", event.type, e instanceof Error ? e.name : e);
    return new NextResponse("Processing failed", { status: 500 });
  }
}
