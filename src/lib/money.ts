/** Money is integer cents. Parse/format without floats. */
export function dollarsToCents(input: string): number | null {
  const m = /^\$?(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

export function formatCents(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

export function centsToDollarsInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Amount for a number of minutes at an hourly rate, rounded half-up to the cent, integer math only. */
export function amountForMinutes(minutes: number, rateCents: number): number {
  return Math.floor((minutes * rateCents * 2 + 60) / 120);
}

export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
