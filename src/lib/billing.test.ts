import { describe, expect, it } from "vitest";
import {
  balanceCents, computeTotals, formatNumber, formatQuantity, isOverdue, lineAmount,
  minutesToQuantityMilli, parseQuantity, statusAfterPayment, taxFor,
} from "./billing";

describe("lineAmount", () => {
  it("multiplies and rounds half-up", () => {
    expect(lineAmount(1000, 12500)).toBe(12500);
    expect(lineAmount(1500, 10000)).toBe(15000);
    expect(lineAmount(333, 1000)).toBe(333); // 0.333 x $10.00 = $3.33
    expect(lineAmount(1, 500)).toBe(1); // 0.5 cent rounds up
    expect(lineAmount(1, 499)).toBe(0);
  });
  it("handles credits (negative prices)", () => {
    expect(lineAmount(1000, -2500)).toBe(-2500);
    expect(lineAmount(1, -500)).toBe(-1);
  });
});

describe("taxFor", () => {
  it("rounds half-up on bps", () => {
    expect(taxFor(10000, 825)).toBe(825);
    expect(taxFor(1, 5000)).toBe(1); // 0.5c -> 1
    expect(taxFor(999, 825)).toBe(82); // 82.4175
  });
  it("is zero for exempt or non-positive bases", () => {
    expect(taxFor(10000, 0)).toBe(0);
    expect(taxFor(-500, 825)).toBe(0);
  });
});

describe("computeTotals", () => {
  it("taxes only taxable lines, once per document", () => {
    const t = computeTotals(
      [
        { quantityMilli: 2000, unitPriceCents: 15000, taxable: true },
        { quantityMilli: 1000, unitPriceCents: 5000, taxable: false },
      ],
      825,
    );
    expect(t.lineAmounts).toEqual([30000, 5000]);
    expect(t.subtotalCents).toBe(35000);
    expect(t.taxCents).toBe(2475);
    expect(t.totalCents).toBe(37475);
  });
  it("empty document is zero", () => {
    expect(computeTotals([], 825)).toEqual({ lineAmounts: [], subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });
});

describe("quantity", () => {
  it("parses and formats", () => {
    expect(parseQuantity("1.5")).toBe(1500);
    expect(parseQuantity("2")).toBe(2000);
    expect(parseQuantity("0.125")).toBe(125);
    expect(parseQuantity("1.2345")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(formatQuantity(1500)).toBe("1.5");
    expect(formatQuantity(2000)).toBe("2");
    expect(formatQuantity(125)).toBe("0.125");
  });
  it("converts minutes to hours", () => {
    expect(minutesToQuantityMilli(90)).toBe(1500);
    expect(minutesToQuantityMilli(20)).toBe(333);
    expect(minutesToQuantityMilli(40)).toBe(667);
  });
});

describe("invoice state", () => {
  const base = { status: "SENT" as const, totalCents: 10000, paidCents: 0, dueDate: null };
  it("derives status from payments", () => {
    expect(statusAfterPayment({ ...base, paidCents: 0 })).toBe("SENT");
    expect(statusAfterPayment({ ...base, paidCents: 4000 })).toBe("PARTIALLY_PAID");
    expect(statusAfterPayment({ ...base, paidCents: 10000 })).toBe("PAID");
    expect(statusAfterPayment({ ...base, paidCents: 12000 })).toBe("PAID");
    expect(statusAfterPayment({ ...base, status: "PAID", paidCents: 3000 })).toBe("PARTIALLY_PAID"); // after refund
  });
  it("never moves DRAFT or VOID", () => {
    expect(statusAfterPayment({ ...base, status: "DRAFT", paidCents: 10000 })).toBe("DRAFT");
    expect(statusAfterPayment({ ...base, status: "VOID", paidCents: 10000 })).toBe("VOID");
  });
  it("computes balance and overdue", () => {
    expect(balanceCents({ totalCents: 10000, paidCents: 2500 })).toBe(7500);
    expect(balanceCents({ totalCents: 10000, paidCents: 20000 })).toBe(0);
    const today = new Date("2026-11-10T00:00:00Z");
    expect(isOverdue({ ...base, dueDate: new Date("2026-11-09T00:00:00Z") }, today)).toBe(true);
    expect(isOverdue({ ...base, dueDate: today }, today)).toBe(false);
    expect(isOverdue({ ...base, status: "PAID", dueDate: new Date("2026-01-01T00:00:00Z") }, today)).toBe(false);
  });
  it("formats numbers", () => {
    expect(formatNumber("INV", 7)).toBe("INV-0007");
    expect(formatNumber("Q", 12345)).toBe("Q-12345");
  });
});

import { displayInvoiceStatus } from "./billing";

describe("displayInvoiceStatus", () => {
  const today = new Date(Date.UTC(2026, 10, 10));
  const past = new Date(Date.UTC(2026, 10, 1));
  const base = { totalCents: 1000, paidCents: 0, dueDate: past };
  it("shows Payment pending while a payment is processing, even if overdue", () => {
    expect(displayInvoiceStatus({ ...base, status: "SENT", processing: true }, today)).toBe("PROCESSING");
    expect(displayInvoiceStatus({ ...base, status: "PARTIALLY_PAID", processing: true }, today)).toBe("PROCESSING");
  });
  it("Paid, Void and Draft always win", () => {
    for (const status of ["PAID", "VOID", "DRAFT"] as const) {
      expect(displayInvoiceStatus({ ...base, status, processing: true }, today)).toBe(status);
    }
  });
  it("falls back to overdue, then the stored status", () => {
    expect(displayInvoiceStatus({ ...base, status: "SENT" }, today)).toBe("OVERDUE");
    expect(displayInvoiceStatus({ ...base, status: "SENT", dueDate: new Date(Date.UTC(2026, 11, 1)) }, today)).toBe("SENT");
  });
});
