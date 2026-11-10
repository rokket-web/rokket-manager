import { z } from "zod";
import { MAX_INSTALLMENTS } from "@/lib/installments";
import { percentToBps } from "@/lib/tax";

/** One editable (not yet invoiced) installment row from the plan editor. `id` is empty for a new row. */
export const planRowSchema = z.object({
  id: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
  label: z.string().trim().min(1, "Give each installment a label").max(120),
  percent: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const bps = percentToBps(v.replace(/%$/, ""));
      if (bps === null || bps <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage like 40 or 33.33" });
        return z.NEVER;
      }
      return bps;
    }),
});

export const planInputSchema = z.object({
  rows: z.array(planRowSchema).max(MAX_INSTALLMENTS, `Use at most ${MAX_INSTALLMENTS} installments`),
});
export type PlanRowInput = z.output<typeof planRowSchema>;
