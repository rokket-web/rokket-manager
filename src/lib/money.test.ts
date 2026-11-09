import { describe, expect, it } from "vitest";
import { amountForMinutes, dollarsToCents, formatCents, formatMinutes } from "./money";

describe("money", () => {
  it("parses dollars exactly", () => {
    expect(dollarsToCents("1500")).toBe(150000);
    expect(dollarsToCents("1,500.5")).toBe(150050);
    expect(dollarsToCents("$0.07")).toBe(7);
    expect(dollarsToCents("19.99")).toBe(1999);
  });
  it("rejects bad input", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "12.", ".5"]) expect(dollarsToCents(bad)).toBeNull();
  });
  it("formats cents", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-250)).toBe("-$2.50");
    expect(formatCents(1000, "EUR")).toBe("EUR 10.00");
  });
  it("prices minutes with integer half-up rounding", () => {
    expect(amountForMinutes(60, 10000)).toBe(10000);
    expect(amountForMinutes(90, 10000)).toBe(15000);
    expect(amountForMinutes(1, 10000)).toBe(167); // 166.67 -> 167
    expect(amountForMinutes(0, 10000)).toBe(0);
    expect(amountForMinutes(7, 0)).toBe(0);
  });
  it("formats minutes", () => {
    expect(formatMinutes(95)).toBe("1h 35m");
    expect(formatMinutes(5)).toBe("0h 05m");
  });
});
