import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { getDownloadUrl } from "@/server/services/files";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { StorageNotConfiguredError } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authorizes, then redirects to a 5-minute signed URL. The file itself never passes through this server. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const url = await getDownloadUrl(actor, id);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    if (e instanceof StorageNotConfiguredError)
      return new NextResponse("File storage is not configured", { status: 503 });
    throw e;
  }
}
