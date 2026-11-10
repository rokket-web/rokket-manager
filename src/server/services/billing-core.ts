import type { Prisma } from "@/generated/prisma/client";
import { computeTotals, formatNumber } from "@/lib/billing";
import { MAX_DOCUMENT_CENTS, type LineInput } from "@/lib/validation/billing";
import { NotFoundError } from "@/server/errors";
import { z } from "zod";

export type Tx = Prisma.TransactionClient;

/** Gapless counter. Row-locks inside the caller's transaction, so concurrent sends serialize. */
export async function nextNumber(tx: Tx, prefix: "INV" | "Q"): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("key", "value") VALUES (${prefix}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return formatNumber(prefix, rows[0].value);
}

/** Client rate wins (0 = exempt); otherwise the default setting; otherwise 0. */
export async function resolveTaxRateBps(tx: Tx, clientId: string): Promise<number> {
  const client = await tx.client.findUnique({ where: { id: clientId }, select: { taxRateBps: true } });
  if (!client) throw new NotFoundError("Client not found.");
  if (client.taxRateBps != null) return client.taxRateBps;
  const s = await tx.setting.findUnique({ where: { key: "defaultTaxRateBps" } });
  return typeof s?.value === "number" ? s.value : 0;
}

export async function assertProjectBelongsToClient(tx: Tx, projectId: string | null, clientId: string) {
  if (!projectId) return;
  const p = await tx.project.findFirst({ where: { id: projectId, clientId }, select: { id: true } });
  if (!p) {
    throw new z.ZodError([
      { code: "custom", path: ["projectId"], message: "Project must belong to this client", input: projectId },
    ]);
  }
}

/** Server-side totals; the client never supplies amounts. Rejects documents that would overflow INT columns. */
export function buildLines(lines: LineInput[], taxRateBps: number) {
  const totals = computeTotals(
    lines.map((l) => ({ quantityMilli: l.quantity, unitPriceCents: l.unitPrice, taxable: l.taxable })),
    taxRateBps,
  );
  if (totals.totalCents > MAX_DOCUMENT_CENTS) {
    throw new z.ZodError([
      { code: "custom", path: ["lines"], message: "Document total is too large", input: totals.totalCents },
    ]);
  }
  const rows = lines.map((l, i) => ({
    position: i,
    description: l.description,
    quantityMilli: l.quantity,
    unitPriceCents: l.unitPrice,
    taxable: l.taxable,
    amountCents: totals.lineAmounts[i],
  }));
  return {
    rows,
    taxRateBps,
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  };
}

export async function logClientActivity(
  tx: Tx,
  clientId: string,
  actorId: string | null,
  type: string,
  summary: string,
) {
  await tx.activity.create({ data: { clientId, actorId, type, summary } });
}
