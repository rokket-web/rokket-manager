import { z } from "zod";
import { percentToBps } from "@/lib/tax";

export const CLIENT_STATUSES = ["LEAD", "ACTIVE", "PAST"] as const;
export const statusSchema = z.enum(CLIENT_STATUSES);

const optStr = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const optEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
  .pipe(z.email("Enter a valid email").nullable());

export function normalizeTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim().toLowerCase().replace(/\s+/g, " ");
    if (t) seen.add(t);
  }
  return [...seen];
}

const tags = z
  .string()
  .max(1000)
  .optional()
  .transform((v) => normalizeTags(v ?? ""))
  .pipe(z.array(z.string().max(30, "Tags must be 30 characters or fewer")).max(20, "At most 20 tags"));

const taxRate = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null; // blank = use default rate
    const bps = percentToBps(v);
    if (bps === null) {
      ctx.addIssue({ code: "custom", message: "Enter a percentage from 0 to 100, e.g. 8.25" });
      return z.NEVER;
    }
    return bps;
  });

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  status: statusSchema.default("LEAD"),
  website: optStr(200),
  industry: optStr(100),
  email: optEmail,
  phone: optStr(50),
  addressLine1: optStr(200),
  addressLine2: optStr(200),
  city: optStr(100),
  state: optStr(100),
  postalCode: optStr(20),
  country: optStr(100),
  billingEmail: optEmail,
  taxRate, // output: taxRateBps | null
  tags,
});
export type ClientInput = z.output<typeof clientInputSchema>;

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().max(100).default(""),
  email: optEmail,
  phone: optStr(50),
  title: optStr(100),
  isPrimary: z.coerce.boolean().default(false),
});
export type ContactInput = z.output<typeof contactInputSchema>;

export const noteInputSchema = z.object({ body: z.string().trim().min(1, "Note cannot be empty").max(5000) });

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: statusSchema.optional(),
  tag: z.string().trim().toLowerCase().max(30).optional(),
  sort: z.enum(["name", "newest", "status"]).default("name"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.output<typeof listQuerySchema>;

export const idSchema = z.string().min(1).max(40);
