"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/authz/session";
import { updateBillingSettings } from "@/server/services/settings";
import { formToObject, toFormState, type FormState } from "../clients/form-state";

export async function saveBillingSettingsAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  try {
    await updateBillingSettings(actor, values);
  } catch (e) {
    return toFormState(e, values);
  }
  revalidatePath("/settings");
  return { ok: true };
}
