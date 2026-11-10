import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getAdminMessagesSince } from "@/server/services/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin's open thread polls this for new messages. POST (not GET) because it marks incoming messages as read. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const after = new Date(String(((await req.json().catch(() => null)) as { after?: unknown } | null)?.after ?? ""));
  if (Number.isNaN(after.getTime())) return new NextResponse("Bad request", { status: 400 });
  try {
    return NextResponse.json({ messages: await getAdminMessagesSince(actor, id, after) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
