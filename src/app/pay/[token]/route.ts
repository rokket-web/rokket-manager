import { NextResponse } from "next/server";
import { ConflictError, NotFoundError } from "@/server/errors";
import { StripeNotConfiguredError } from "@/server/stripe";
import { startCheckout } from "@/server/services/stripe-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public pay link: the unguessable token authorises paying THIS invoice, nothing else. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const { url } = await startCheckout(token);
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    if (e instanceof ConflictError) return new NextResponse(e.message, { status: 409 });
    if (e instanceof StripeNotConfiguredError) return new NextResponse("Online payments are unavailable.", { status: 503 });
    console.error("[pay]", e instanceof Error ? e.name : e);
    return new NextResponse("Something went wrong. Please try again.", { status: 500 });
  }
}
