/**
 * Flat-fee installment math. Integer cents and basis points only (4000 bps = 40%).
 * Every row but the last open one is round-half-up(fee x share); the last open row takes the remainder,
 * so the amounts always add up to the fee exactly. Invoiced (locked) rows keep the amount they were billed at.
 */

export const STANDARD_SPLIT_BPS = [4000, 4000, 2000] as const;
export const MAX_INSTALLMENTS = 24;

export type PlanRow = { basisPoints: number; lockedAmountCents?: number | null };
export type AllocateResult = { ok: true; amounts: number[] } | { ok: false; error: string };

export function standardLabel(index: number, count: number): string {
  return `Installment ${index + 1} of ${count}`;
}

export function totalBps(rows: Pick<PlanRow, "basisPoints">[]): number {
  return rows.reduce((s, r) => s + r.basisPoints, 0);
}

export function allocateInstallments(feeCents: number, rows: PlanRow[]): AllocateResult {
  if (!Number.isInteger(feeCents) || feeCents <= 0) return { ok: false, error: "Set a flat fee first." };
  if (rows.length === 0) return { ok: false, error: "Add at least one installment." };
  if (rows.length > MAX_INSTALLMENTS) return { ok: false, error: `Use at most ${MAX_INSTALLMENTS} installments.` };
  if (rows.some((r) => !Number.isInteger(r.basisPoints) || r.basisPoints <= 0)) {
    return { ok: false, error: "Every installment needs a percentage above zero." };
  }
  const sum = totalBps(rows);
  if (sum !== 10000) {
    return { ok: false, error: `Percentages must add up to 100% (currently ${sum / 100}%).` };
  }
  const isLocked = (r: PlanRow) => r.lockedAmountCents != null;
  const open = rows.map((r, i) => (isLocked(r) ? -1 : i)).filter((i) => i >= 0);
  const lockedSum = rows.reduce((s, r) => s + (r.lockedAmountCents ?? 0), 0);
  const amounts = rows.map((r) => r.lockedAmountCents ?? 0);
  if (open.length === 0) {
    return lockedSum === feeCents ? { ok: true, amounts } : { ok: false, error: "Invoiced installments no longer add up to the flat fee." };
  }
  let running = lockedSum;
  for (const i of open.slice(0, -1)) {
    amounts[i] = Math.floor((feeCents * rows[i].basisPoints + 5000) / 10000);
    running += amounts[i];
  }
  const last = open[open.length - 1];
  amounts[last] = feeCents - running;
  if (open.some((i) => amounts[i] <= 0)) return { ok: false, error: "Each installment must come to at least one cent." };
  return { ok: true, amounts };
}
