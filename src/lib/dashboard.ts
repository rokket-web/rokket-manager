/** Pure helpers for the dashboard. All dates are UTC so they match the @db.Date columns. */

export type Money = { currency: string; cents: number };

export function utcToday(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Monday 00:00 UTC of the week containing `now`. */
export function startOfWeekUtc(now: Date = new Date()): Date {
  const today = utcToday(now);
  const sinceMonday = (today.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  return new Date(today.getTime() - sinceMonday * 86_400_000);
}

export function monthBoundsUtc(now: Date = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)),
    next: new Date(Date.UTC(y, m + 1, 1)),
    prevStart: new Date(Date.UTC(y, m - 1, 1)),
  };
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Sum cents per currency, largest first. Mixed currencies are never added together. */
export function sumByCurrency(rows: Money[]): Money[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.cents);
  return [...by.entries()].map(([currency, cents]) => ({ currency, cents })).sort((a, b) => b.cents - a.cents);
}

export type Severity = "high" | "medium" | "low";
export type AttentionItem = { id: string; severity: Severity; title: string; detail: string; href: string };

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** High first; stable within a severity so the caller's own ordering (e.g. oldest first) is kept. */
export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => ORDER[a.item.severity] - ORDER[b.item.severity] || a.i - b.i)
    .map((x) => x.item);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
