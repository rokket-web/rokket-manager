import Papa from "papaparse";

export const CLIENT_CSV_HEADERS = [
  "name",
  "status",
  "website",
  "industry",
  "email",
  "phone",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "billing_email",
  "tax_rate_percent",
  "tags",
] as const;

/** Neutralize spreadsheet formula injection (=, +, -, @, tab, CR at cell start). */
export function safeCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: readonly string[], rows: Record<string, unknown>[]): string {
  return Papa.unparse(
    { fields: [...headers], data: rows.map((r) => headers.map((h) => safeCell(r[h]))) },
    { newline: "\r\n" },
  );
}

export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ROWS = 500;

export type ParsedCsv = { rows: Record<string, string>[]; error?: string };

export function parseCsv(text: string): ParsedCsv {
  if (text.length > MAX_IMPORT_BYTES) return { rows: [], error: "File is too large (max 1 MB)." };
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
    transform: (v) => v.trim(),
  });
  if (!res.meta.fields?.includes("name")) return { rows: [], error: 'The CSV must have a "name" column.' };
  if (res.data.length > MAX_IMPORT_ROWS) return { rows: [], error: `Too many rows (max ${MAX_IMPORT_ROWS}).` };
  return { rows: res.data };
}

/** Map a CSV row to the shape clientInputSchema expects (strings in form style). */
export function rowToClientInput(r: Record<string, string>) {
  return {
    name: r.name,
    status: (r.status || "LEAD").toUpperCase(),
    website: r.website,
    industry: r.industry,
    email: r.email,
    phone: r.phone,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    postalCode: r.postal_code,
    country: r.country,
    billingEmail: r.billing_email,
    taxRate: r.tax_rate_percent,
    tags: r.tags,
  };
}
