"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/authz/session";
import { ConflictError, NotFoundError } from "@/server/errors";
import { clearPlan, createInvoiceFromInstallment, createStandardBilling, savePlan } from "@/server/services/installments";
import { toFormState, type FormState } from "../clients/form-state";

const back = (projectId: string, error?: string, notice?: string) => {
  const p = new URLSearchParams({ tab: "billing" });
  if (error) p.set("error", error);
  if (notice) p.set("notice", notice);
  redirect(`/projects/${projectId}?${p}`);
};

async function guarded(projectId: string, notice: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ConflictError || e instanceof NotFoundError) back(projectId, e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  back(projectId, undefined, notice);
}

export async function createStandardBillingAction(projectId: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(projectId, "Standard billing created: 40% / 40% / 20%.", () => createStandardBilling(actor, projectId));
}

export async function clearPlanAction(projectId: string) {
  const actor = await requireActor(["ADMIN"]);
  await guarded(projectId, "Billing plan removed.", () => clearPlan(actor, projectId));
}

/** Rows arrive as parallel inputs (rowId / rowLabel / rowPercent) from the plan editor. */
export async function savePlanAction(projectId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const ids = fd.getAll("rowId").map(String);
  const labels = fd.getAll("rowLabel").map(String);
  const percents = fd.getAll("rowPercent").map(String);
  const rows = labels.map((label, i) => ({ id: ids[i] ?? "", label, percent: percents[i] ?? "" }));
  try {
    await savePlan(actor, projectId, { rows });
  } catch (e) {
    if (e instanceof ConflictError || e instanceof NotFoundError) return { error: e.message };
    return toFormState(e);
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function invoiceInstallmentAction(projectId: string, installmentId: string) {
  const actor = await requireActor(["ADMIN"]);
  let invoiceId: string;
  try {
    invoiceId = (await createInvoiceFromInstallment(actor, installmentId)).id;
  } catch (e) {
    if (e instanceof ConflictError || e instanceof NotFoundError) back(projectId, e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/invoices/${invoiceId}`);
}
