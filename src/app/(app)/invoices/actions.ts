"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/authz/session";
import { ConflictError } from "@/server/errors";
import {
  createInvoice,
  createInvoiceFromTime,
  deleteDraftInvoice,
  markInvoiceSent,
  updateInvoice,
  voidInvoice,
} from "@/server/services/invoices";
import { recordManualPayment } from "@/server/services/payments";
import { toFormState, type FormState } from "../clients/form-state";
import { docValues, formToDoc } from "../billing-form";

const back = (id: string, error?: string) =>
  redirect(`/invoices/${id}${error ? `?error=${encodeURIComponent(error)}` : ""}`);

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
  try {
    await fn();
  } catch (e) {
    if (e instanceof ConflictError) back(id, e.message);
    throw e;
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  back(id);
}

export async function sendInvoiceAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(id, () => markInvoiceSent(actor, id));
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
