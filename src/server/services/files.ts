import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, clientScope, type ActorLike } from "@/server/authz/clients";
import { assertProject, projectScope } from "@/server/authz/projects";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { fileRequestSchema } from "@/lib/validation/project";
import { getStorage, type FileStorage } from "@/server/storage";
import { z } from "zod";

// Executable / script types are refused outright. Everything else is stored private and served as attachment only.
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|sh|js|mjs|vbs|ps1|jar|apk|dmg|app|html?|svg|php)$/i;

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "file";
}

async function authorizeTarget(actor: ActorLike, clientId: string, projectId: string | null) {
  if (projectId) {
    assertProject(actor, "file:write");
    const p = await db.project.findFirst({
      where: { AND: [{ id: projectId }, { clientId }, projectScope(actor)] },
      select: { id: true },
    });
    if (!p) throw new NotFoundError("Project not found.");
  } else {
    assertCan(actor, "client:write"); // client-level files are admin-only
    const c = await db.client.findFirst({
      where: { AND: [{ id: clientId }, clientScope(actor)] },
      select: { id: true },
    });
    if (!c) throw new NotFoundError("Client not found.");
  }
}

export async function requestUpload(actor: ActorLike, raw: unknown, storage?: FileStorage) {
  const input = fileRequestSchema.parse(raw);
  const name = safeFilename(input.filename);
  if (BLOCKED_EXT.test(name))
    throw new z.ZodError([
      { code: "custom", path: ["filename"], message: "This file type is not allowed", input: name },
    ]);
  await authorizeTarget(actor, input.clientId, input.projectId);
  const store = storage ?? getStorage(); // after authorization; before any row is created
  const storageKey = `clients/${input.clientId}/${input.projectId ?? "general"}/${randomUUID()}-${name}`;
  const file = await db.fileAsset.create({
    data: {
      clientId: input.clientId,
      projectId: input.projectId,
      storageKey,
      name,
      size: input.size,
      mime: input.mime,
      uploadedById: actor.id,
    },
  });
  const uploadUrl = await store.createUploadUrl(storageKey, { mime: input.mime });
  return { fileId: file.id, uploadUrl, contentType: input.mime };
}

export async function confirmUpload(actor: ActorLike, fileId: string, storage?: FileStorage) {
  const f = await db.fileAsset.findUnique({ where: { id: fileId } });
  if (!f || f.uploadedById !== actor.id || f.status !== "PENDING") throw new NotFoundError("Upload not found.");
  const store = storage ?? getStorage();
  const stat = await store.stat(f.storageKey);
  if (!stat)
    throw new z.ZodError([
      { code: "custom", path: ["file"], message: "The file did not finish uploading", input: fileId },
    ]);
  if (stat.size !== f.size) {
    await store.remove(f.storageKey);
    await db.fileAsset.delete({ where: { id: fileId } });
    throw new z.ZodError([
      { code: "custom", path: ["file"], message: "Uploaded file size did not match", input: fileId },
    ]);
  }
  const ready = await db.$transaction(async (tx) => {
    const r = await tx.fileAsset.update({ where: { id: fileId }, data: { status: "READY" } });
    await audit(
      {
        actorId: actor.id,
        action: "file.upload",
        entity: "FileAsset",
        entityId: fileId,
        meta: { name: f.name, size: f.size },
      },
      tx,
    );
    return r;
  });
  return ready;
}

function fileWhere(actor: ActorLike): Prisma.FileAssetWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role === "STAFF") return { project: projectScope(actor) }; // staff: only files on their projects
  return { id: { in: [] } };
}

export async function listFiles(actor: ActorLike, scope: { clientId?: string; projectId?: string }) {
  if (actor.role === "CLIENT") throw new ForbiddenError();
  return withRetry(() =>
    db.fileAsset.findMany({
      where: {
        AND: [
          fileWhere(actor),
          { status: "READY" },
          scope.projectId ? { projectId: scope.projectId } : {},
          scope.clientId ? { clientId: scope.clientId } : {},
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        size: true,
        mime: true,
        createdAt: true,
        uploadedById: true,
        projectId: true,
        clientId: true,
      },
    }),
  );
}

export async function getDownloadUrl(actor: ActorLike, fileId: string, storage?: FileStorage) {
  if (actor.role === "CLIENT") throw new ForbiddenError(); // portal downloads get their own layer in Phase 5
  const f = await db.fileAsset.findFirst({ where: { AND: [{ id: fileId }, fileWhere(actor), { status: "READY" }] } });
  if (!f) throw new NotFoundError("File not found.");
  await audit({ actorId: actor.id, action: "file.download", entity: "FileAsset", entityId: fileId });
  return (storage ?? getStorage()).createDownloadUrl(f.storageKey, { filename: f.name });
}

export async function deleteFile(actor: ActorLike, fileId: string, storage?: FileStorage) {
  if (actor.role === "CLIENT") throw new ForbiddenError();
  const f = await db.fileAsset.findFirst({ where: { AND: [{ id: fileId }, fileWhere(actor)] } });
  if (!f) throw new NotFoundError("File not found.");
  if (actor.role !== "ADMIN" && f.uploadedById !== actor.id) throw new ForbiddenError(); // staff may delete only their own uploads
  await db.$transaction(async (tx) => {
    await tx.fileAsset.delete({ where: { id: fileId } });
    await audit(
      { actorId: actor.id, action: "file.delete", entity: "FileAsset", entityId: fileId, meta: { name: f.name } },
      tx,
    );
  });
  try {
    await (storage ?? getStorage()).remove(f.storageKey);
  } catch {
    /* orphaned object is swept in Phase 6 */
  }
}
