import { describe, expect, it } from "vitest";
import { allocateInstallments, STANDARD_SPLIT_BPS, standardLabel } from "./installments";

const std = STANDARD_SPLIT_BPS.map((basisPoints) => ({ basisPoints }));
const ok = (fee: number, rows: Parameters<typeof allocateInstallments>[1]) => {
  const r = allocateInstallments(fee, rows);
  if (!r.ok) throw new Error(r.error);
  return r.amounts;
};

describe("standard 40/40/20", () => {
  it("splits a round fee exactly", () => {
    expect(ok(1000000, std)).toEqual([400000, 400000, 200000]); // $10,000
  });
  it("always sums to the fee, with the remainder on the last installment", () => {
    for (const fee of [1, 3, 99, 100, 101, 12345, 999999, 1234567, 2_000_000_000]) {
      const r = allocateInstallments(fee, std);
      if (fee < 3) {
        expect(r.ok).toBe(false); // too small to give each installment a cent
      } else {
        expect(r.ok && r.amounts.reduce((a, b) => a + b, 0)).toBe(fee);
      }
    }
    expect(ok(100001, std)).toEqual([40000, 40000, 20001]); // 40000.4 -> 40000 twice, remainder 20001
    expect(ok(1234567, std)).toEqual([493827, 493827, 246913]); // .. + remainder
  });
  it("rounds half-up before the remainder", () => {
    expect(ok(12345, [{ basisPoints: 5000 }, { basisPoints: 5000 }])).toEqual([6173, 6172]); // 6172.5 -> 6173
  });
});

describe("custom plans", () => {
  it("supports any count and percentages that total 100", () => {
    expect(ok(100000, [{ basisPoints: 5000 }, { basisPoints: 5000 }])).toEqual([50000, 50000]);
    expect(ok(100000, [{ basisPoints: 10000 }])).toEqual([100000]);
    expect(ok(100000, [2500, 2500, 2500, 2500].map((basisPoints) => ({ basisPoints })))).toEqual([25000, 25000, 25000, 25000]);
    expect(ok(100000, [3333, 3333, 3334].map((basisPoints) => ({ basisPoints })))).toEqual([33330, 33330, 33340]);
  });
  it("rejects bad percentages", () => {
    const bad = (rows: { basisPoints: number }[]) => allocateInstallments(100000, rows);
    expect(bad([{ basisPoints: 5000 }, { basisPoints: 4000 }])).toMatchObject({ ok: false, error: expect.stringContaining("90%") });
    expect(bad([{ basisPoints: 6000 }, { basisPoints: 6000 }])).toMatchObject({ ok: false, error: expect.stringContaining("120%") });
    expect(bad([{ basisPoints: 10000 }, { basisPoints: 0 }])).toMatchObject({ ok: false });
    expect(bad([])).toMatchObject({ ok: false });
    expect(allocateInstallments(0, std)).toMatchObject({ ok: false });
    expect(allocateInstallments(100000, Array.from({ length: 25 }, () => ({ basisPoints: 400 })))).toMatchObject({ ok: false });
  });
});

describe("locked (already invoiced) installments", () => {
  it("keeps their billed amounts and reshapes only the rest", () => {
    // 40% was invoiced at $4,000; the other 60% is re-split 30/30
    const amounts = ok(1000000, [
      { basisPoints: 4000, lockedAmountCents: 400000 },
      { basisPoints: 3000 },
      { basisPoints: 3000 },
    ]);
    expect(amounts).toEqual([400000, 300000, 300000]);
  });
  it("absorbs rounding in the last open row, not the locked ones", () => {
    const amounts = ok(100001, [
      { basisPoints: 4000, lockedAmountCents: 40000 },
      { basisPoints: 4000 },
      { basisPoints: 2000 },
    ]);
    expect(amounts).toEqual([40000, 40000, 20001]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(100001);
  });
  it("is fine when everything is already invoiced and consistent, and rejects inconsistency", () => {
    expect(ok(1000, [{ basisPoints: 6000, lockedAmountCents: 600 }, { basisPoints: 4000, lockedAmountCents: 400 }])).toEqual([600, 400]);
    expect(allocateInstallments(1000, [{ basisPoints: 6000, lockedAmountCents: 600 }, { basisPoints: 4000, lockedAmountCents: 300 }])).toMatchObject({ ok: false });
  });
  it("refuses when locked amounts leave nothing for the open rows", () => {
    expect(allocateInstallments(1000, [{ basisPoints: 9000, lockedAmountCents: 1000 }, { basisPoints: 1000 }])).toMatchObject({ ok: false });
  });
});

describe("labels", () => {
  it("numbers installments", () => {
    expect(standardLabel(0, 3)).toBe("Installment 1 of 3");
    expect(standardLabel(2, 3)).toBe("Installment 3 of 3");
  });
});
