import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";
import { billingSettingsSchema, type CompanyProfile } from "@/lib/validation/settings";
import type { Prisma } from "@/generated/prisma/client";

const FALLBACK: CompanyProfile = { name: "Rokket", address: null, email: null, phone: null, paymentInstructions: null };

type Reader = Pick<typeof db, "setting">;

/** Company details printed on quotes/invoices. Falls back to a bare name until the admin saves settings. */
export async function readCompanyProfile(reader: Reader = db): Promise<CompanyProfile> {
  const row = await reader.setting.findUnique({ where: { key: "companyProfile" } });
  const v = row?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return FALLBACK;
  const o = v as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : null);
  return {
    name: s("name") ?? FALLBACK.name,
    address: s("address"),
    email: s("email"),
    phone: s("phone"),
    paymentInstructions: s("paymentInstructions"),
  };
}

export async function getBillingSettings(actor: ActorLike) {
  assertBilling(actor, "billing:read");
  return withRetry(async () => {
    const [company, tax] = await Promise.all([
      readCompanyProfile(),
      db.setting.findUnique({ where: { key: "defaultTaxRateBps" } }),
    ]);
    return { company, defaultTaxRateBps: typeof tax?.value === "number" ? tax.value : 0 };
  });
}

export async function updateBillingSettings(actor: ActorLike, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = billingSettingsSchema.parse(raw);
  const profile: Prisma.InputJsonValue = {
    name: input.companyName,
    address: input.companyAddress,
    email: input.companyEmail,
    phone: input.companyPhone,
    paymentInstructions: input.paymentInstructions,
  };
  await db.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key: "companyProfile" }, update: { value: profile }, create: { key: "companyProfile", value: profile } });
    await tx.setting.upsert({
      where: { key: "defaultTaxRateBps" },
      update: { value: input.defaultTaxRate },
      create: { key: "defaultTaxRateBps", value: input.defaultTaxRate },
    });
    await audit(
      { actorId: actor.id, action: "settings.billing.update", entity: "Setting", meta: { defaultTaxRateBps: input.defaultTaxRate } },
      tx,
    );
  });
}
