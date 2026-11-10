"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ConflictError } from "@/server/errors";
import { requireActor } from "@/server/authz/session";
import {
  addContact,
  addNote,
  createClient,
  deleteClient,
  deleteContact,
  deleteNote,
  importClientsCsv,
  setClientStatus,
  updateClient,
  updateContact,
  type ImportResult,
} from "@/server/services/clients";
import { headers } from "next/headers";
import { inviteClientUser, resendPortalInvite, setPortalActive } from "@/server/services/portal-access";
import { formToObject, toFormState, type FormState } from "./form-state";

export async function createClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  let id: string;
  try {
    id = (await createClient(actor, values)).id;
  } catch (e) {
    return toFormState(e, values);
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function updateClientAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  try {
    await updateClient(actor, id, values);
  } catch (e) {
    return toFormState(e, values);
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function deleteClientAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  try {
    await deleteClient(actor, id);
  } catch (e) {
    if (e instanceof ConflictError) redirect(`/clients/${id}?error=has-projects`);
    throw e;
  }
  revalidatePath("/clients");
  redirect("/clients");
}

export async function setStatusAction(id: string, fd: FormData) {
  const actor = await requireActor(["ADMIN"]);
  await setClientStatus(actor, id, fd.get("status"));
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function addContactAction(clientId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  try {
    await addContact(actor, clientId, { ...values, isPrimary: values.isPrimary === "on" ? "true" : "" });
  } catch (e) {
    return toFormState(e, values);
  }
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function updateContactAction(
  clientId: string,
  contactId: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  try {
    await updateContact(actor, contactId, { ...values, isPrimary: values.isPrimary === "on" ? "true" : "" });
  } catch (e) {
    return toFormState(e, values);
  }
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function deleteContactAction(clientId: string, contactId: string) {
  const actor = await requireActor(["ADMIN"]);
  await deleteContact(actor, contactId);
  revalidatePath(`/clients/${clientId}`);
}

export async function addNoteAction(clientId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  try {
    await addNote(actor, clientId, formToObject(fd));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function deleteNoteAction(clientId: string, noteId: string) {
  const actor = await requireActor(["ADMIN"]);
  await deleteNote(actor, noteId);
  revalidatePath(`/clients/${clientId}`);
}

export type ImportState = (ImportResult & { done: true }) | { done?: false; error?: string };

export async function importCsvAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const actor = await requireActor(["ADMIN"]);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 1_000_000) return { error: "File is too large (max 1 MB)." };
  try {
    const result = await importClientsCsv(actor, await file.text());
    revalidatePath("/clients");
    return { ...result, done: true };
  } catch (e) {
    return { error: toFormState(e).error };
  }
}

// ----- portal access (admin) -----
export async function invitePortalUserAction(clientId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  try {
    const r = await inviteClientUser(actor, clientId, values, await headers());
    revalidatePath(`/clients/${clientId}`);
    if (!r.sent) return { error: r.error };
    return { ok: true };
  } catch (e) {
    if (e instanceof ConflictError) return { error: e.message, values };
    return toFormState(e, values);
  }
}

const portalBack = (clientId: string, error?: string, notice?: string) => {
  const p = new URLSearchParams({ tab: "portal" });
  if (error) p.set("error", error);
  if (notice) p.set("notice", notice);
  redirect(`/clients/${clientId}?${p}`);
};

export async function resendPortalInviteAction(clientId: string) {
  const actor = await requireActor(["ADMIN"]);
  try {
    const r = await resendPortalInvite(actor, clientId, await headers());
    revalidatePath(`/clients/${clientId}`);
    if (!r.sent) portalBack(clientId, r.error);
    portalBack(clientId, undefined, "Invite email sent.");
  } catch (e) {
    if (e instanceof ConflictError) portalBack(clientId, e.message);
    throw e;
  }
}

export async function setPortalActiveAction(clientId: string, active: boolean) {
  const actor = await requireActor(["ADMIN"]);
  await setPortalActive(actor, clientId, active);
  revalidatePath(`/clients/${clientId}`);
  portalBack(clientId, undefined, active ? "Portal access restored." : "Portal access turned off and sessions ended.");
}
