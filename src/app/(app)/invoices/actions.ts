"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/authz/session";
import { ConflictError } from "@/server/errors";
import {
  createInvoice,
  createInvoiceFromTime,
  deleteDraftInvoice,
  updateInvoice,
  voidInvoice,
} from "@/server/services/invoices";
import { recordManualPayment } from "@/server/services/payments";
import { refundPayment } from "@/server/services/stripe-payments";
import { dollarsToCents } from "@/lib/money";
import { resendInvoice, sendInvoice, type SendResult } from "@/server/services/billing-email";
import { toFormState, type FormState } from "../clients/form-state";
import { docValues, formToDoc } from "../billing-form";

const back = (id: string, error?: string, notice?: string) => {
  const p = new URLSearchParams();
  if (error) p.set("error", error);
  if (notice) p.set("notice", notice);
  redirect(`/invoices/${id}${p.size ? `?${p}` : ""}`);
};

const outcome = (r: SendResult) => (r.emailed ? { notice: `Emailed to ${r.to}.` } : { error: r.error });

export async function createInvoiceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const doc = formToDoc(fd);
  let id: string;
  try {
    id = (await createInvoice(actor, doc)).id;
  } catch (e) {
    return toFormState(e, docValues(doc));
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

export async function updateInvoiceAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const doc = formToDoc(fd);
  try {
    await updateInvoice(actor, id, doc);
  } catch (e) {
    if (e instanceof ConflictError) return { error: e.message, values: docValues(doc) };
    return toFormState(e, docValues(doc));
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

export async function createFromTimeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = {
    projectId: String(fd.get("projectId") ?? ""),
    from: String(fd.get("from") ?? ""),
    to: String(fd.get("to") ?? ""),
  };
  let id: string;
  try {
    id = (await createInvoiceFromTime(actor, values)).id;
  } catch (e) {
    if (e instanceof ConflictError) return { error: e.message, values };
    return toFormState(e, values);
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

async function guarded(id: string, fn: () => Promise<unknown>) {
  let res: { notice?: string; error?: string } = {};
  try {
    const r = await fn();
    if (r && typeof r === "object" && "emailed" in r) res = outcome(r as SendResult);
  } catch (e) {
    if (e instanceof ConflictError) back(id, e.message);
    throw e;
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  back(id, res.error, res.notice);
}

export async function sendInvoiceAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => sendInvoice(actor, id));
}

export async function resendInvoiceAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => resendInvoice(actor, id));
}

export async function voidInvoiceAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => voidInvoice(actor, id));
}

export async function deleteInvoiceAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  try {
    await deleteDraftInvoice(actor, id);
  } catch (e) {
    if (e instanceof ConflictError) back(id, e.message);
    throw e;
  }
  revalidatePath("/invoices");
  redirect("/invoices");
}

export async function recordPaymentAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = {
    amount: String(fd.get("amount") ?? ""),
    reference: String(fd.get("reference") ?? ""),
    paidAt: String(fd.get("paidAt") ?? ""),
  };
  try {
    await recordManualPayment(actor, id, values);
  } catch (e) {
    if (e instanceof ConflictError) return { error: e.message, values };
    return toFormState(e, values);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

export async function refundPaymentAction(invoiceId: string, paymentId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = { amount: String(fd.get("amount") ?? "") };
  const cents = dollarsToCents(values.amount);
  if (cents === null || cents <= 0) {
    return { error: "Enter an amount like 25 or 25.50.", values };
  }
  try {
    await refundPayment(actor, paymentId, cents);
  } catch (e) {
    if (e instanceof ConflictError) return { error: e.message, values };
    return toFormState(e, values);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true };
}
