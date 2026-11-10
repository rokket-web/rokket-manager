"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/authz/session";
import { ConflictError } from "@/server/errors";
import { createInvoiceFromQuote } from "@/server/services/invoices";
import { createQuote, deleteDraftQuote, recordQuoteResponse, updateQuote } from "@/server/services/quotes";
import { resendQuote, sendQuote, type SendResult } from "@/server/services/billing-email";
import { toFormState, type FormState } from "../clients/form-state";
import { docValues, formToDoc } from "../billing-form";

const back = (id: string, error?: string, notice?: string) => {
  const p = new URLSearchParams();
  if (error) p.set("error", error);
  if (notice) p.set("notice", notice);
  redirect(`/quotes/${id}${p.size ? `?${p}` : ""}`);
};

export async function createQuoteAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const doc = formToDoc(fd);
  let id: string;
  try {
    id = (await createQuote(actor, doc)).id;
  } catch (e) {
    return toFormState(e, docValues(doc));
  }
  revalidatePath("/quotes");
  redirect(`/quotes/${id}`);
}

export async function updateQuoteAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const doc = formToDoc(fd);
  try {
    await updateQuote(actor, id, doc);
  } catch (e) {
    if (e instanceof ConflictError) return { error: e.message, values: docValues(doc) };
    return toFormState(e, docValues(doc));
  }
  revalidatePath("/quotes");
  redirect(`/quotes/${id}`);
}

async function guarded(id: string, fn: () => Promise<unknown>) {
  let res: { notice?: string; error?: string } = {};
  try {
    const r = await fn();
    if (r && typeof r === "object" && "emailed" in r) {
      const o = r as SendResult;
      res = o.emailed ? { notice: `Emailed to ${o.to}.` } : { error: o.error };
    }
  } catch (e) {
    if (e instanceof ConflictError) back(id, e.message);
    throw e;
  }
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  back(id, res.error, res.notice);
}

export async function sendQuoteAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => sendQuote(actor, id));
}

export async function resendQuoteAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => resendQuote(actor, id));
}

export async function acceptQuoteAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => recordQuoteResponse(actor, id, "ACCEPTED"));
}

export async function declineQuoteAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => recordQuoteResponse(actor, id, "DECLINED"));
}

export async function deleteQuoteAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  try {
    await deleteDraftQuote(actor, id);
  } catch (e) {
    if (e instanceof ConflictError) back(id, e.message);
    throw e;
  }
  revalidatePath("/quotes");
  redirect("/quotes");
}

export async function invoiceFromQuoteAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  let invoiceId: string;
  try {
    invoiceId = (await createInvoiceFromQuote(actor, id)).id;
  } catch (e) {
    if (e instanceof ConflictError) back(id, e.message);
    throw e;
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${invoiceId}`);
}
