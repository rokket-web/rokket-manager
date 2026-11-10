"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/authz/session";
import { ConflictError, NotFoundError } from "@/server/errors";
import { StripeNotConfiguredError } from "@/server/stripe";
import { respondToPortalQuote, startPortalCheckout } from "@/server/services/portal";

const back = (path: string, error?: string, notice?: string) => {
  const p = new URLSearchParams();
  if (error) p.set("error", error);
  if (notice) p.set("notice", notice);
  redirect(`${path}${p.size ? `?${p}` : ""}`);
};

export async function payInvoiceAction(id: string) {
  const actor = await requireActor(["CLIENT"]);
  const path = `/portal/invoices/${id}`;
  let url: string;
  try {
    url = (await startPortalCheckout(actor, id)).url;
  } catch (e) {
    if (e instanceof ConflictError) back(path, e.message);
    if (e instanceof StripeNotConfiguredError) back(path, "Online payment is not available right now. Please contact us.");
    if (e instanceof NotFoundError) redirect("/portal/invoices");
    throw e;
  }
  redirect(url);
}

async function respond(id: string, response: "ACCEPTED" | "DECLINED") {
  const actor = await requireActor(["CLIENT"]);
  const path = `/portal/quotes/${id}`;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  try {
    await respondToPortalQuote(actor, id, response, { ip });
  } catch (e) {
    if (e instanceof ConflictError) back(path, e.message);
    if (e instanceof NotFoundError) redirect("/portal/quotes");
    throw e;
  }
  revalidatePath("/portal", "layout");
  back(path, undefined, response === "ACCEPTED" ? "Thank you. You accepted this quote." : "You declined this quote.");
}

export const acceptQuoteAction = async (id: string) => respond(id, "ACCEPTED");
export const declineQuoteAction = async (id: string) => respond(id, "DECLINED");
