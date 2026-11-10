"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/authz/session";
import { ConflictError } from "@/server/errors";
import { createProject, deleteProject, setProjectMembers, updateProject } from "@/server/services/projects";
import {
  addComment,
  createMilestone,
  createTask,
  deleteComment,
  deleteMilestone,
  deleteTask,
  setTaskStatus,
  updateMilestone,
  updateTask,
} from "@/server/services/tasks";
import { addManualEntry, deleteTimeEntry, startTimer, stopTimer } from "@/server/services/time";
import { setItemsVisibility, setProjectVisibility } from "@/server/services/portal-sharing";
import { confirmUpload, deleteFile, requestUpload } from "@/server/services/files";
import { StorageNotConfiguredError } from "@/server/storage";
import { formToObject, toFormState, type FormState } from "../clients/form-state";

const INTERNAL = ["ADMIN", "STAFF"] as const;
// An unticked checkbox sends nothing, which must mean false (not the schema default).
const checkbox = (v: Record<string, string>, k: string) => ({ ...v, [k]: v[k] === "on" ? "true" : "false" });

async function run(fn: () => Promise<unknown>, values?: Record<string, string>): Promise<FormState> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof ConflictError) return { error: e.message, values };
    return toFormState(e, values);
  }
}

// ----- projects (admin) -----
export async function createProjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  let id: string;
  try {
    id = (await createProject(actor, values)).id;
  } catch (e) {
    return toFormState(e, values);
  }
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  try {
    await updateProject(actor, id, values);
  } catch (e) {
    return toFormState(e, values);
  }
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

export async function deleteProjectAction(id: string) {
  const actor = await requireActor(["ADMIN"]);
  await deleteProject(actor, id);
  revalidatePath("/projects");
  redirect("/projects");
}

export async function setMembersAction(projectId: string, fd: FormData) {
  const actor = await requireActor(["ADMIN"]);
  await setProjectMembers(actor, projectId, fd.getAll("userId").map(String));
  revalidatePath(`/projects/${projectId}`);
}

// ----- milestones (admin) -----
export async function createMilestoneAction(projectId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  const res = await run(() => createMilestone(actor, projectId, values), values);
  if (res.ok) revalidatePath(`/projects/${projectId}`);
  return res;
}

export async function updateMilestoneAction(
  projectId: string,
  milestoneId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const actor = await requireActor(["ADMIN"]);
  const values = formToObject(fd);
  const res = await run(() => updateMilestone(actor, milestoneId, values), values);
  if (res.ok) revalidatePath(`/projects/${projectId}`);
  return res;
}

export async function deleteMilestoneAction(projectId: string, milestoneId: string) {
  const actor = await requireActor(["ADMIN"]);
  await deleteMilestone(actor, milestoneId);
  revalidatePath(`/projects/${projectId}`);
}

// ----- tasks -----
export async function createTaskAction(projectId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor([...INTERNAL]);
  const values = formToObject(fd);
  const res = await run(() => createTask(actor, projectId, values), values);
  if (res.ok) revalidatePath(`/projects/${projectId}`);
  return res;
}

export async function updateTaskAction(
  projectId: string,
  taskId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const actor = await requireActor([...INTERNAL]);
  const values = formToObject(fd);
  const res = await run(() => updateTask(actor, taskId, values), values);
  if (res.ok) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  }
  return res;
}

export async function setTaskStatusAction(projectId: string, taskId: string, fd: FormData) {
  const actor = await requireActor([...INTERNAL]);
  await setTaskStatus(actor, taskId, fd.get("status"));
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

export async function deleteTaskAction(projectId: string, taskId: string) {
  const actor = await requireActor([...INTERNAL]);
  await deleteTask(actor, taskId);
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?tab=tasks`);
}

export async function addCommentAction(
  projectId: string,
  taskId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const actor = await requireActor([...INTERNAL]);
  const res = await run(() => addComment(actor, taskId, formToObject(fd)));
  if (res.ok) revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  return res;
}

export async function deleteCommentAction(projectId: string, taskId: string, commentId: string) {
  const actor = await requireActor([...INTERNAL]);
  await deleteComment(actor, commentId);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

// ----- time -----
export async function startTimerAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor([...INTERNAL]);
  const values = formToObject(fd);
  const res = await run(() => startTimer(actor, checkbox(values, "billable")), values);
  if (res.ok) revalidatePath("/time");
  return res;
}

export async function stopTimerAction() {
  const actor = await requireActor([...INTERNAL]);
  await stopTimer(actor);
  revalidatePath("/time");
}

export async function addManualTimeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor([...INTERNAL]);
  const values = formToObject(fd);
  const res = await run(() => addManualEntry(actor, checkbox(values, "billable")), values);
  if (res.ok) revalidatePath("/time");
  return res;
}

export async function deleteTimeAction(entryId: string) {
  const actor = await requireActor([...INTERNAL]);
  await deleteTimeEntry(actor, entryId);
  revalidatePath("/time");
}

// ----- files (browser uploads directly to storage with a signed URL) -----
export type UploadRequest = { fileId: string; uploadUrl: string; contentType: string } | { error: string };

export async function requestUploadAction(input: {
  clientId: string;
  projectId?: string;
  filename: string;
  size: number;
  mime: string;
}): Promise<UploadRequest> {
  const actor = await requireActor([...INTERNAL]);
  try {
    return await requestUpload(actor, { ...input, projectId: input.projectId ?? "" });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) return { error: "File storage is not configured yet." };
    return {
      error: toFormState(e).fieldErrors
        ? Object.values(toFormState(e).fieldErrors!).flat().join(" ")
        : (toFormState(e).error ?? "Upload failed."),
    };
  }
}

export async function confirmUploadAction(
  fileId: string,
  revalidate: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireActor([...INTERNAL]);
  try {
    await confirmUpload(actor, fileId);
    revalidatePath(revalidate);
    return { ok: true };
  } catch (e) {
    const s = toFormState(e);
    return { ok: false, error: s.fieldErrors ? Object.values(s.fieldErrors).flat().join(" ") : s.error };
  }
}

export async function deleteFileAction(fileId: string, revalidate: string) {
  const actor = await requireActor([...INTERNAL]);
  await deleteFile(actor, fileId);
  revalidatePath(revalidate);
}

// ----- client portal sharing (admin) -----
export async function setProjectVisibilityAction(projectId: string, visible: boolean) {
  const actor = await requireActor(["ADMIN"]);
  await setProjectVisibility(actor, projectId, visible);
  revalidatePath(`/projects/${projectId}`);
}

export async function setItemsVisibilityAction(projectId: string, kind: "milestone" | "task", ids: string[] | null, visible: boolean) {
  const actor = await requireActor(["ADMIN"]);
  await setItemsVisibility(actor, projectId, kind, ids, visible);
  revalidatePath(`/projects/${projectId}`);
}
