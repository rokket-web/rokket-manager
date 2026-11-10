import { z } from "zod";
import { dollarsToCents } from "@/lib/money";
import { parseQuantity } from "@/lib/billing";
import { boolish } from "@/lib/validation/boolish";
import { dateField } from "@/lib/validation/project";

// Bounds keep quantity x price < 2^53 and every stored total inside Postgres INT.
export const MAX_QUANTITY_MILLI = 1_000_000; // 1000 units
export const MAX_UNIT_PRICE_CENTS = 1_000_000_000; // $10M
export const MAX_DOCUMENT_CENTS = 2_000_000_000;
export const MAX_LINES = 100;

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const optId = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v) => (v ? v : null));

export const lineInputSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(500),
  quantity: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const q = parseQuantity(v);
      if (q === null || q <= 0 || q > MAX_QUANTITY_MILLI) {
        ctx.addIssue({ code: "custom", message: "Quantity must be between 0.001 and 1000" });
        return z.NEVER;
      }
      return q;
    }),
  unitPrice: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const c = dollarsToCents(v);
      if (c === null || c > MAX_UNIT_PRICE_CENTS) {
        ctx.addIssue({ code: "custom", message: "Enter an amount like 150 or 150.50" });
        return z.NEVER;
      }
      return c;
    }),
  taxable: boolish().default(true),
});
export type LineInput = z.output<typeof lineInputSchema>;

const base = {
  clientId: z.string().trim().min(1).max(40),
  projectId: optId,
  notes: optStr(5000),
  terms: optStr(5000),
  lines: z.array(lineInputSchema).min(1, "Add at least one line").max(MAX_LINES),
};

export const quoteInputSchema = z.object({ ...base, title: optStr(200), validUntil: dateField });
export const invoiceInputSchema = z.object({ ...base, dueDate: dateField });

export const manualPaymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const c = dollarsToCents(v);
      if (c === null || c <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter an amount like 150 or 150.50" });
        return z.NEVER;
      }
      return c;
    }),
  reference: optStr(200),
  paidAt: dateField,
});

export const fromTimeSchema = z.object({
  projectId: z.string().trim().min(1).max(40),
  from: dateField,
  to: dateField,
});

export const billingListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(20).optional(),
  clientId: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
