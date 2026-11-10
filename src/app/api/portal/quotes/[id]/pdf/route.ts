import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { renderPortalQuotePdf } from "@/server/services/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Portal client downloads THEIR OWN document. Scoping happens in the service; other clients' ids are plain 404s. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { bytes, filename } = await renderPortalQuotePdf(actor, id);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
}
