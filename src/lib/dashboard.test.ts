import { describe, expect, it } from "vitest";
import { daysBetween, monthBoundsUtc, plural, sortAttention, startOfWeekUtc, sumByCurrency, utcToday, type AttentionItem } from "./dashboard";

describe("dates", () => {
  it("finds Monday of the week (Wed -> Mon, Sun -> previous Mon, Mon -> itself)", () => {
    expect(startOfWeekUtc(new Date("2026-11-11T15:30:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Wed
    expect(startOfWeekUtc(new Date("2026-11-15T23:59:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Sun
    expect(startOfWeekUtc(new Date("2026-11-09T00:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Mon
  });
  it("computes month bounds across a year boundary", () => {
    const b = monthBoundsUtc(new Date("2026-01-20T10:00:00Z"));
    expect(b.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(b.next.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(b.prevStart.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });
  it("utcToday drops the time and daysBetween counts whole days", () => {
    expect(utcToday(new Date("2026-11-10T23:59:59Z")).toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(daysBetween(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-10T12:00:00Z"))).toBe(9);
  });
});

describe("sumByCurrency", () => {
  it("adds within a currency, never across, largest first", () => {
    expect(
      sumByCurrency([
        { currency: "EUR", cents: 500 },
        { currency: "USD", cents: 1000 },
        { currency: "USD", cents: 250 },
      ]),
    ).toEqual([
      { currency: "USD", cents: 1250 },
      { currency: "EUR", cents: 500 },
    ]);
    expect(sumByCurrency([])).toEqual([]);
  });
});

describe("sortAttention", () => {
  const item = (id: string, severity: AttentionItem["severity"]): AttentionItem => ({ id, severity, title: id, detail: "", href: "/" });
  it("orders by severity and keeps input order within a severity", () => {
    const out = sortAttention([item("a", "low"), item("b", "high"), item("c", "medium"), item("d", "high")]);
    expect(out.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("plural", () => {
  it("handles one and many", () => {
    expect(plural(1, "invoice")).toBe("1 invoice");
    expect(plural(3, "invoice")).toBe("3 invoices");
    expect(plural(2, "category", "categories")).toBe("2 categories");
  });
});
