import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatQuantity } from "@/lib/billing";
import { formatCents } from "@/lib/money";
import { bpsToPercent } from "@/lib/tax";

export type PdfParty = { name: string; lines: string[] };
export type PdfLine = { description: string; quantityMilli: number; unitPriceCents: number; amountCents: number };
export type PdfDocData = {
  kind: "INVOICE" | "QUOTE";
  number: string | null;
  title: string | null;
  currency: string;
  from: PdfParty;
  to: PdfParty;
  meta: [label: string, value: string][];
  lines: PdfLine[];
  taxRateBps: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents?: number;
  notes: string | null;
  terms: string | null;
  footer: string | null;
};

const W = 595.28;
const H = 841.89;
const M = 50;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);

/** Standard PDF fonts only cover WinAnsi. Replace anything else rather than throwing mid-render. */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text.replace(/\t/g, "  ").replace(/\r/g, "")) {
    const c = ch.codePointAt(0)!;
    out += c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? ch : c === 0x2019 ? "'" : c === 0x2013 || c === 0x2014 ? "-" : "?";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      let w = word;
      // Hard-split words wider than the column (long URLs, no spaces).
      while (font.widthOfTextAtSize(w, size) > maxWidth) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxWidth) n--;
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function renderPdf(d: PdfDocData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const money = (c: number) => pdfSafe(formatCents(c, d.currency));
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, size = 10, f = font, color = INK) =>
    page.drawText(pdfSafe(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 10, f = font, color = INK) => {
    const t = pdfSafe(s);
    page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  };
  const rule = () => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: RULE });
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const ensure = (h: number, redrawHeader?: () => void) => {
    if (y - h < M + 30) {
      newPage();
      redrawHeader?.();
    }
  };

  // Header
  text(d.from.name, M, 16, bold);
  right(d.kind === "INVOICE" ? "INVOICE" : "QUOTE", W - M, 20, bold, MUTED);
  y -= 16;
  for (const l of d.from.lines.flatMap((x) => wrap(x, font, 9, 240))) {
    text(l, M, 9, font, MUTED);
    y -= 12;
  }
  let ry = H - M - 30;
  const metaRows: [string, string][] = [["Number", d.number ?? "Draft"], ...d.meta];
  for (const [k, v] of metaRows) {
    const keep = y;
    y = ry;
    text(k, W - M - 180, 9, font, MUTED);
    right(v, W - M, 9, bold);
    ry -= 13;
    y = keep;
  }
  y = Math.min(y, ry) - 18;

  // Bill to
  text("BILL TO", M, 8, bold, MUTED);
  y -= 13;
  text(d.to.name, M, 11, bold);
  y -= 14;
  for (const l of d.to.lines.flatMap((x) => wrap(x, font, 9, 260))) {
    text(l, M, 9);
    y -= 12;
  }
  if (d.title) {
    y -= 6;
    text(d.title, M, 11, bold);
    y -= 14;
  }
  y -= 14;

  // Table
  const colQty = W - M - 200;
  const colUnit = W - M - 110;
  const colAmt = W - M;
  const descW = colQty - M - 40;
  const header = () => {
    text("Description", M, 8, bold, MUTED);
    right("Qty", colQty, 8, bold, MUTED);
    right("Unit price", colUnit, 8, bold, MUTED);
    right("Amount", colAmt, 8, bold, MUTED);
    y -= 6;
    rule();
    y -= 14;
  };
  header();
  for (const l of d.lines) {
    const desc = wrap(l.description, font, 10, descW);
    ensure(desc.length * 13 + 8, header);
    const top = y;
    right(formatQuantity(l.quantityMilli), colQty);
    right(money(l.unitPriceCents), colUnit);
    right(money(l.amountCents), colAmt);
    for (const line of desc) {
      text(line, M);
      y -= 13;
    }
    y = Math.min(y, top - 13) - 4;
  }
  rule();
  y -= 16;

  // Totals
  ensure(80);
  const totals: [string, string, boolean][] = [
    ["Subtotal", money(d.subtotalCents), false],
    [`Tax (${bpsToPercent(d.taxRateBps)}%)`, money(d.taxCents), false],
    ["Total", money(d.totalCents), true],
  ];
  if (d.paidCents && d.paidCents > 0) {
    totals.push(["Paid", `-${money(d.paidCents)}`, false], ["Balance due", money(Math.max(0, d.totalCents - d.paidCents)), true]);
  }
  for (const [k, v, strong] of totals) {
    ensure(18);
    text(k, W - M - 180, strong ? 11 : 10, strong ? bold : font);
    right(v, W - M, strong ? 11 : 10, strong ? bold : font);
    y -= 17;
  }
  y -= 10;

  for (const [label, body] of [["Notes", d.notes], ["Terms", d.terms]] as const) {
    if (!body) continue;
    const lines = wrap(body, font, 9, W - 2 * M);
    ensure(30);
    text(label.toUpperCase(), M, 8, bold, MUTED);
    y -= 13;
    for (const l of lines) {
      ensure(13);
      text(l, M, 9);
      y -= 12;
    }
    y -= 8;
  }

  if (d.footer) {
    const lines = wrap(d.footer, font, 9, W - 2 * M);
    ensure(lines.length * 12 + 20);
    y -= 4;
    rule();
    y -= 14;
    for (const l of lines) {
      text(l, M, 9, font, MUTED);
      y -= 12;
    }
  }

  pdf.setTitle(pdfSafe(`${d.kind === "INVOICE" ? "Invoice" : "Quote"} ${d.number ?? "draft"}`));
  pdf.setProducer("Rokket Manager");
  return pdf.save();
}
