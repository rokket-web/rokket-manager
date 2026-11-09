/** Tax rates are stored as integer basis points (825 = 8.25%). Never floats. */
export function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return bps <= 10000 ? bps : null;
}

export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

export function formatTax(bps: number | null | undefined): string {
  if (bps == null) return "Default rate";
  return bps === 0 ? "Exempt (0%)" : `${bpsToPercent(bps)}%`;
}
