import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { ForbiddenError } from "@/server/errors";
import { portalUnreadCount } from "@/server/services/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unread messages for the signed-in client (the sidebar badge polls this). Read-only, scoped to their own thread. */
export async function GET() {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  try {
    return NextResponse.json({ count: await portalUnreadCount(actor) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
}
