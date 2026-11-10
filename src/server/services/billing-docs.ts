import type { ActorLike } from "@/server/authz/clients";
import { renderPdf, type PdfDocData } from "@/server/pdf/render";
import { fmtDateUtc } from "@/lib/format";
import { getInvoice } from "./invoices";
import { getQuote } from "./quotes";
import { readCompanyProfile } from "./settings";
import type { CompanyProfile } from "@/lib/validation/settings";

type ClientAddr = {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  billingEmail: string | null;
  email: string | null;
};

function fromParty(c: CompanyProfile) {
  return {
    name: c.name,
    lines: [...(c.address ? c.address.split("\n") : []), ...[c.email, c.phone].filter((x): x is string => !!x)],
  };
}

function toParty(c: ClientAddr) {
  const cityLine = [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    name: c.name,
    lines: [c.addressLine1, c.addressLine2, cityLine, c.country, c.billingEmail ?? c.email].filter((x): x is string => !!x),
  };
}

export async function renderInvoicePdf(actor: ActorLike, id: string) {
  const inv = await getInvoice(actor, id);
  const company = await readCompanyProfile();
  const data: PdfDocData = {
    kind: "INVOICE",
    number: inv.number,
    title: null,
    currency: inv.currency,
    from: fromParty(company),
    to: toParty(inv.client),
    meta: [
      ["Issued", fmtDateUtc(inv.issueDate)],
      ["Due", fmtDateUtc(inv.dueDate)],
    ],
    lines: inv.lines,
    taxRateBps: inv.taxRateBps,
    subtotalCents: inv.subtotalCents,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    notes: inv.notes,
    terms: inv.terms,
    footer: company.paymentInstructions,
  };
  return { bytes: await renderPdf(data), filename: `${inv.number ?? "invoice-draft"}.pdf`, inv, company };
}

export async function renderQuotePdf(actor: ActorLike, id: string) {
  const q = await getQuote(actor, id);
  const company = await readCompanyProfile();
  const data: PdfDocData = {
    kind: "QUOTE",
    number: q.number,
    title: q.title,
    currency: q.currency,
    from: fromParty(company),
    to: toParty(q.client),
    meta: [
      ["Date", fmtDateUtc(q.sentAt ?? q.createdAt)],
      ["Valid until", fmtDateUtc(q.validUntil)],
    ],
    lines: q.lines,
    taxRateBps: q.taxRateBps,
    subtotalCents: q.subtotalCents,
    taxCents: q.taxCents,
    totalCents: q.totalCents,
    notes: q.notes,
    terms: q.terms,
    footer: null,
  };
  return { bytes: await renderPdf(data), filename: `${q.number ?? "quote-draft"}.pdf`, quote: q, company };
}
