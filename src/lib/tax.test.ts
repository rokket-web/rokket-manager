import { describe, expect, it } from "vitest";
import { bpsToPercent, formatTax, percentToBps } from "./tax";

describe("tax rates (basis points, no floats)", () => {
  it("parses percentages exactly", () => {
    expect(percentToBps("8.25")).toBe(825);
    expect(percentToBps("8")).toBe(800);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("7.5")).toBe(750);
    expect(percentToBps("100")).toBe(10000);
    expect(percentToBps("0.07")).toBe(7);
  });
  it("rejects invalid input", () => {
    for (const bad of ["", "abc", "-1", "100.01", "101", "8.255", "8,5", "1e2", " "])
      expect(percentToBps(bad)).toBeNull();
  });
  it("round-trips", () => {
    for (const bps of [0, 7, 50, 600, 750, 825, 10000]) expect(percentToBps(bpsToPercent(bps))).toBe(bps);
  });
  it("formats for display", () => {
    expect(formatTax(null)).toBe("Default rate");
    expect(formatTax(0)).toBe("Exempt (0%)");
    expect(formatTax(825)).toBe("8.25%");
    expect(formatTax(600)).toBe("6%");
  });
});
