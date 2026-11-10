import { z } from "zod";

export const messageInputSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000, "Message is too long (5000 characters max)"),
});

export const clientEmailInputSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(150, "Subject is too long")
    .refine((s) => !/[\r\n]/.test(s), "Subject must be a single line"),
  body: z.string().trim().min(1, "Message cannot be empty").max(10000, "Message is too long (10000 characters max)"),
});
