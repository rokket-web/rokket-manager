import { z } from "zod";
import { percentToBps } from "@/lib/tax";

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const billingSettingsSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(120),
  companyAddress: optStr(500),
  companyEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .pipe(z.email("Enter a valid email").nullable()),
  companyPhone: optStr(50),
  paymentInstructions: optStr(1000),
  defaultTaxRate: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return 0;
      const bps = percentToBps(v.replace(/%$/, ""));
      if (bps === null) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage like 8.25" });
        return z.NEVER;
      }
      return bps;
    }),
});

export type CompanyProfile = {
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  paymentInstructions: string | null;
};
