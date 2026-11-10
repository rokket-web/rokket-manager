import { db, withRetry } from "@/server/db";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";

/** Pickers for the quote/invoice editors. Tax is the effective rate (client override, else default setting). */
export async function listBillingOptions(actor: ActorLike) {
  assertBilling(actor, "billing:read");
  const [clients, projects, setting] = await withRetry(() =>
    Promise.all([
      db.client.findMany({ orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, taxRateBps: true } }),
      db.project.findMany({
        orderBy: { name: "asc" },
        take: 1000,
        select: { id: true, name: true, clientId: true },
      }),
      db.setting.findUnique({ where: { key: "defaultTaxRateBps" } }),
    ]),
  );
  const fallback = typeof setting?.value === "number" ? setting.value : 0;
  return {
    clients: clients.map((c) => ({ id: c.id, name: c.name, taxRateBps: c.taxRateBps ?? fallback })),
    projects,
  };
}
