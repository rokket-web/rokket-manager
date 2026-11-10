import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { renderInvoicePdf } from "@/server/services/billing-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { bytes, filename } = await renderInvoicePdf(actor, id);
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
