/**
 * Pure billing math. Integer cents and basis points only, never floats.
 * Quantities are thousandths (1500 = 1.5) so hours/units can be fractional.
 */

export type LineInput = { quantityMilli: number; unitPriceCents: number; taxable: boolean };

export type Totals = { lineAmounts: number[]; subtotalCents: number; taxCents: number; totalCents: number };

/** quantity x unit price, rounded half-up to the cent. */
export function lineAmount(quantityMilli: number, unitPriceCents: number): number {
  const product = quantityMilli * unitPriceCents; // < 2^53 for validated inputs
  if (product >= 0) return Math.floor((product + 500) / 1000);
  return -Math.floor((-product + 500) / 1000);
}

/** Tax on the taxable subtotal, rounded half-up to the cent. Applied once per document, not per line. */
export function taxFor(taxableCents: number, taxRateBps: number): number {
  if (taxRateBps <= 0 || taxableCents <= 0) return 0;
  return Math.floor((taxableCents * taxRateBps + 5000) / 10000);
}

export function computeTotals(lines: LineInput[], taxRateBps: number): Totals {
  const lineAmounts = lines.map((l) => lineAmount(l.quantityMilli, l.unitPriceCents));
  const subtotalCents = lineAmounts.reduce((a, b) => a + b, 0);
  const taxableCents = lines.reduce((sum, l, i) => sum + (l.taxable ? lineAmounts[i] : 0), 0);
  const taxCents = taxFor(taxableCents, taxRateBps);
  return { lineAmounts, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/** "1.5" -> 1500. Up to 3 decimals. */
export function parseQuantity(input: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0") || 0);
}

export function formatQuantity(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Minutes -> thousandths of an hour, rounded half-up. */
export function minutesToQuantityMilli(minutes: number): number {
  return Math.floor((minutes * 1000 + 30) / 60);
}

export type InvoiceState = {
  status: "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "VOID";
  totalCents: number;
  paidCents: number;
  dueDate: Date | null;
};

export function balanceCents(i: Pick<InvoiceState, "totalCents" | "paidCents">): number {
  return Math.max(0, i.totalCents - i.paidCents);
}

/** Status after payments change. DRAFT and VOID never auto-transition. */
export function statusAfterPayment(i: InvoiceState): InvoiceState["status"] {
  if (i.status === "DRAFT" || i.status === "VOID") return i.status;
  if (i.totalCents > 0 && i.paidCents >= i.totalCents) return "PAID";
  return i.paidCents > 0 ? "PARTIALLY_PAID" : "SENT";
}

/** Overdue is derived, never stored. `today` is a UTC date at midnight. */
export function isOverdue(i: InvoiceState, today: Date): boolean {
  return (i.status === "SENT" || i.status === "PARTIALLY_PAID") && !!i.dueDate && i.dueDate < today;
}

export function formatNumber(prefix: "INV" | "Q", n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}
