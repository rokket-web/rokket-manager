import { NextResponse } from "next/server";
import { getActor } from "@/server/authz/session";
import { exportClientsCsv } from "@/server/services/clients";
import { ForbiddenError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const csv = await exportClientsCsv(actor);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clients-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
}
