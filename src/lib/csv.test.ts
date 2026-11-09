import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, parseCsv, rowToClientInput, safeCell, toCsv } from "./csv";

describe("CSV", () => {
  it("neutralizes formula injection", () => {
    for (const v of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", "\rx"]) expect(safeCell(v).startsWith("'")).toBe(true);
    expect(safeCell("Acme")).toBe("Acme");
    expect(safeCell(null)).toBe("");
  });
  it("quotes commas and quotes on export", () => {
    const out = toCsv(["name", "tags"], [{ name: 'Smith, "Jr" & Co', tags: "a, b" }]);
    expect(out).toBe('name,tags\r\n"Smith, ""Jr"" & Co","a, b"');
  });
  it("parses headers case-insensitively and trims", () => {
    const { rows, error } = parseCsv("﻿Name, Postal Code\n Acme , 12345\n\n");
    expect(error).toBeUndefined();
    expect(rows).toEqual([{ name: "Acme", postal_code: "12345" }]);
  });
  it("requires a name column and caps size", () => {
    expect(parseCsv("email\na@b.co").error).toMatch(/name/);
    const big = "name\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `c${i}`).join("\n");
    expect(parseCsv(big).error).toMatch(/Too many/);
    expect(parseCsv("name\n" + "x".repeat(1_000_001)).error).toMatch(/too large/);
  });
  it("maps rows to form-shaped input with LEAD default", () => {
    expect(rowToClientInput({ name: "A", status: "" }).status).toBe("LEAD");
    expect(rowToClientInput({ name: "A", status: "active", tax_rate_percent: "8.25" })).toMatchObject({
      status: "ACTIVE",
      taxRate: "8.25",
    });
  });
});
