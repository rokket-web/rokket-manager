import { z } from "zod";
import { dollarsToCents } from "@/lib/money";
import { boolish } from "@/lib/validation/boolish";

const optStr = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const dateField = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date" });
      return z.NEVER;
    }
    return d;
  });

const moneyField = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const c = dollarsToCents(v);
    if (c === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 1500 or 1500.50" });
      return z.NEVER;
    }
    return c;
  });

const id = z.string().min(1).max(40);
const optId = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v) => (v ? v : null));

export const BILLING_TYPES = ["HOURLY", "FLAT_FEE"] as const;
export const MAX_FLAT_FEE_CENTS = 2_000_000_000; // keeps every installment inside Postgres INT

export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;

export const projectInputSchema = z
  .object({
    clientId: id,
    name: z.string().trim().min(1, "Name is required").max(200),
    description: optStr(5000),
    status: z.enum(PROJECT_STATUSES).default("PLANNING"),
    budget: moneyField,
    hourlyRate: moneyField,
    billingType: z.enum(BILLING_TYPES).default("HOURLY"),
    flatFee: moneyField,
    startDate: dateField,
    dueDate: dateField,
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    path: ["dueDate"],
    message: "Due date must be on or after the start date",
  })
  .refine((v) => v.billingType !== "FLAT_FEE" || (v.flatFee !== null && v.flatFee > 0), {
    path: ["flatFee"],
    message: "Enter the flat fee for this project",
  })
  .refine((v) => v.flatFee === null || v.flatFee <= MAX_FLAT_FEE_CENTS, {
    path: ["flatFee"],
    message: "That fee is too large",
  });
export type ProjectInput = z.output<typeof projectInputSchema>;

export const projectListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  clientId: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const milestoneInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optStr(2000),
  status: z.enum(MILESTONE_STATUSES).default("PENDING"),
  dueDate: dateField,
  billable: moneyField,
});

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optStr(5000),
  status: z.enum(TASK_STATUSES).default("TODO"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  assigneeId: optId,
  milestoneId: optId,
  dueDate: dateField,
});

export const commentInputSchema = z.object({ body: z.string().trim().min(1, "Comment cannot be empty").max(5000) });

export const timerStartSchema = z.object({
  projectId: id,
  taskId: optId,
  description: optStr(500),
  billable: boolish(true),
});

export const manualTimeSchema = z.object({
  projectId: id,
  taskId: optId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  hours: z.coerce.number().int().min(0).max(24).default(0),
  minutes: z.coerce.number().int().min(0).max(59).default(0),
  description: optStr(500),
  billable: boolish(true),
});

export const fileRequestSchema = z.object({
  clientId: id,
  projectId: optId,
  filename: z.string().trim().min(1).max(200),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024, "Files are limited to 100 MB"),
  mime: z.string().trim().min(1).max(100),
});
