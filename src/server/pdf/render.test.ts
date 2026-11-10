import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfSafe, renderPdf, type PdfDocData } from "./render";

const base: PdfDocData = {
  kind: "INVOICE",
  number: "INV-0001",
  title: null,
  currency: "USD",
  from: { name: "Rokket", lines: ["1 Main St", "Austin, TX"] },
  to: { name: "Acme Plumbing", lines: ["2 Pipe Rd"] },
  meta: [["Due", "Dec 1, 2026"]],
  lines: [{ description: "Website build", quantityMilli: 2000, unitPriceCents: 10000, amountCents: 20000 }],
  taxRateBps: 825,
  subtotalCents: 20000,
  taxCents: 1650,
  totalCents: 21650,
  notes: "Thanks!",
  terms: "Net 30",
  footer: "Pay by check.",
};

describe("pdfSafe", () => {
  it("keeps WinAnsi and replaces the rest", () => {
    expect(pdfSafe("Café 100%")).toBe("Café 100%");
    expect(pdfSafe("日本 ✓")).toBe("?? ?");
    expect(pdfSafe("it’s – ok")).toBe("it's - ok");
  });
});

describe("renderPdf", () => {
  it("produces a valid one-page PDF", async () => {
    const bytes = await renderPdf(base);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
  it("paginates long documents and survives unsupported characters and long unbroken words", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      description: i === 5 ? "日本語 ✓ " + "x".repeat(300) : `Line item number ${i} with some descriptive text`,
      quantityMilli: 1000,
      unitPriceCents: 100,
      amountCents: 100,
    }));
    const bytes = await renderPdf({ ...base, lines, paidCents: 5000, notes: "n\n".repeat(80) });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(2);
  });
  it("renders a draft quote with no number", async () => {
    const bytes = await renderPdf({ ...base, kind: "QUOTE", number: null, title: "Site redesign" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
