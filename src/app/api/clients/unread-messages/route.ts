import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { ForbiddenError } from "@/server/errors";
import { unreadFromClientCount } from "@/server/services/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Total unread client messages across all clients (the admin sidebar badge polls this). Admin only, read-only. */
export async function GET() {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  try {
    return NextResponse.json({ count: await unreadFromClientCount(actor) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
}
