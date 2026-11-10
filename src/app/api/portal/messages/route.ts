import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { ForbiddenError } from "@/server/errors";
import { getPortalMessagesSince } from "@/server/services/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The client's open thread polls this. Always scoped to the signed-in client; no client id is accepted from the request. */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const after = new Date(String(((await req.json().catch(() => null)) as { after?: unknown } | null)?.after ?? ""));
  if (Number.isNaN(after.getTime())) return new NextResponse("Bad request", { status: 400 });
  try {
    return NextResponse.json({ messages: await getPortalMessagesSince(actor, after) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
}
