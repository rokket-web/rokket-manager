import { NextResponse } from "next/server";
import { db, withRetry } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await withRetry(() => db.$queryRaw`SELECT 1`);
    return NextResponse.json({ status: "ok", db: "up", ms: Date.now() - started });
  } catch {
    return NextResponse.json({ status: "error", db: "down", ms: Date.now() - started }, { status: 503 });
  }
}
