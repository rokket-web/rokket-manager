import type { Prisma } from "@/generated/prisma/client";
import { db, withRetry } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, clientScope, type ActorLike } from "@/server/authz/clients";
import { ConflictError, NotFoundError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import {
  clientInputSchema,
  contactInputSchema,
  listQuerySchema,
  noteInputSchema,
  statusSchema,
  type ClientInput,
  type ContactInput,
} from "@/lib/validation/client";
import { CLIENT_CSV_HEADERS, parseCsv, rowToClientInput, toCsv } from "@/lib/csv";
import { bpsToPercent } from "@/lib/tax";

type Tx = Prisma.TransactionClient;

async function logActivity(tx: Tx, clientId: string, actorId: string | null, type: string, summary: string) {
  await tx.activity.create({ data: { clientId, actorId, type, summary } });
}

async function setTags(tx: Tx, clientId: string, names: string[]) {
  await tx.clientTag.deleteMany({ where: { clientId } });
  for (const name of names) {
    const tag = await tx.tag.upsert({ where: { name }, update: {}, create: { name } });
    await tx.clientTag.create({ data: { clientId, tagId: tag.id } });
  }
}

/** Schema output renames taxRate -> bps. Keep one place that maps validated input to columns. */
function toColumns(input: ClientInput & { taxRate: number | null }) {
  const { tags: _t, taxRate, ...rest } = input;
  void _t;
  return { ...rest, taxRateBps: taxRate };
}

// ---------- reads ----------

export async function listClients(actor: ActorLike, rawQuery: unknown) {
  assertCan(actor, "client:read");
  const q = listQuerySchema.parse(rawQuery ?? {});
  const and: Prisma.ClientWhereInput[] = [clientScope(actor)];
  if (q.status) and.push({ status: q.status });
  if (q.tag) and.push({ tags: { some: { tag: { name: q.tag } } } });
  if (q.q) {
    const t = { contains: q.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { name: t },
        { email: t },
        { industry: t },
        { contacts: { some: { OR: [{ firstName: t }, { lastName: t }, { email: t }] } } },
      ],
    });
  }
  const where: Prisma.ClientWhereInput = { AND: and };
  const orderBy: Prisma.ClientOrderByWithRelationInput[] =
    q.sort === "newest"
      ? [{ createdAt: "desc" }]
      : q.sort === "status"
        ? [{ status: "asc" }, { name: "asc" }]
        : [{ name: "asc" }];

  const [items, total] = await withRetry(() =>
    db.$transaction([
      db.client.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          name: true,
          status: true,
          industry: true,
          email: true,
          createdAt: true,
          tags: { select: { tag: { select: { name: true } } } },
          contacts: { where: { isPrimary: true }, take: 1, select: { firstName: true, lastName: true, email: true } },
        },
      }),
      db.client.count({ where }),
    ]),
  );
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
    query: q,
  };
}

export async function listClientOptions(actor: ActorLike) {
  assertCan(actor, "client:read");
  return withRetry(() =>
    db.client.findMany({
      where: clientScope(actor),
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true },
    }),
  );
}

export async function listAllTags(actor: ActorLike) {
  assertCan(actor, "client:read");
  const tags = await withRetry(() =>
    db.tag.findMany({
      where: { clients: { some: { client: clientScope(actor) } } },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  );
  return tags.map((t) => t.name);
}

export async function getClient(actor: ActorLike, id: string) {
  assertCan(actor, "client:read");
  const client = await withRetry(() =>
    db.client.findFirst({
      where: { AND: [{ id }, clientScope(actor)] },
      include: {
        tags: { select: { tag: { select: { name: true } } } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }] },
        notes: { orderBy: { createdAt: "desc" }, take: 200 },
        activities: { orderBy: { createdAt: "desc" }, take: 200 },
      },
    }),
  );
  if (!client) throw new NotFoundError("Client not found.");
  const actorIds = [
    ...new Set(
      [...client.notes.map((n) => n.authorId), ...client.activities.map((a) => a.actorId)].filter(Boolean) as string[],
    ),
  ];
  const users = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return { ...client, tagNames: client.tags.map((t) => t.tag.name), actorNames: names };
}

export async function listPipeline(actor: ActorLike) {
  assertCan(actor, "client:read");
  const rows = await withRetry(() =>
    db.client.findMany({
      where: clientScope(actor),
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, status: true, industry: true, email: true },
    }),
  );
  return {
    LEAD: rows.filter((r) => r.status === "LEAD"),
    ACTIVE: rows.filter((r) => r.status === "ACTIVE"),
    PAST: rows.filter((r) => r.status === "PAST"),
  };
}

// ---------- client writes ----------

async function createClientTx(tx: Tx, actor: ActorLike, input: ClientInput & { taxRate: number | null }) {
  const created = await tx.client.create({ data: toColumns(input) });
  await setTags(tx, created.id, input.tags);
  await logActivity(tx, created.id, actor.id, "client.created", `Client created as ${created.status.toLowerCase()}`);
  await audit(
    {
      actorId: actor.id,
      action: "client.create",
      entity: "Client",
      entityId: created.id,
      meta: { name: created.name },
    },
    tx,
  );
  return created;
}

export async function createClient(actor: ActorLike, raw: unknown) {
  assertCan(actor, "client:write");
  const input = clientInputSchema.parse(raw);
  return db.$transaction((tx) => createClientTx(tx, actor, input));
}

export async function updateClient(actor: ActorLike, id: string, raw: unknown) {
  assertCan(actor, "client:write");
  const input = clientInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.client.findFirst({ where: { AND: [{ id }, clientScope(actor)] } });
    if (!before) throw new NotFoundError("Client not found.");
    const updated = await tx.client.update({ where: { id }, data: toColumns(input) });
    await setTags(tx, id, input.tags);
    if (before.status !== updated.status) {
      await logActivity(
        tx,
        id,
        actor.id,
        "client.status_changed",
        `Status changed from ${before.status.toLowerCase()} to ${updated.status.toLowerCase()}`,
      );
    }
    if (before.taxRateBps !== updated.taxRateBps) {
      await logActivity(
        tx,
        id,
        actor.id,
        "client.tax_changed",
        `Tax rate changed to ${updated.taxRateBps == null ? "default" : bpsToPercent(updated.taxRateBps) + "%"}`,
      );
    }
    await logActivity(tx, id, actor.id, "client.updated", "Client details updated");
    await audit({ actorId: actor.id, action: "client.update", entity: "Client", entityId: id }, tx);
    return updated;
  });
}

export async function setClientStatus(actor: ActorLike, id: string, rawStatus: unknown) {
  assertCan(actor, "client:write");
  const status = statusSchema.parse(rawStatus);
  return db.$transaction(async (tx) => {
    const before = await tx.client.findFirst({
      where: { AND: [{ id }, clientScope(actor)] },
      select: { status: true },
    });
    if (!before) throw new NotFoundError("Client not found.");
    if (before.status === status) return;
    await tx.client.update({ where: { id }, data: { status } });
    await logActivity(
      tx,
      id,
      actor.id,
      "client.status_changed",
      `Status changed from ${before.status.toLowerCase()} to ${status.toLowerCase()}`,
    );
    await audit(
      {
        actorId: actor.id,
        action: "client.status",
        entity: "Client",
        entityId: id,
        meta: { from: before.status, to: status },
      },
      tx,
    );
  });
}

export async function deleteClient(actor: ActorLike, id: string) {
  assertCan(actor, "client:delete");
  const keys = await db.$transaction(async (tx) => {
    const c = await tx.client.findFirst({ where: { AND: [{ id }, clientScope(actor)] }, select: { name: true } });
    if (!c) throw new NotFoundError("Client not found.");
    if (await tx.project.count({ where: { clientId: id } })) {
      throw new ConflictError("This client has projects. Delete or finish those first.");
    }
    const files = await tx.fileAsset.findMany({ where: { clientId: id }, select: { storageKey: true } });
    await audit(
      { actorId: actor.id, action: "client.delete", entity: "Client", entityId: id, meta: { name: c.name } },
      tx,
    );
    await tx.client.delete({ where: { id } });
    return files.map((f) => f.storageKey);
  });
  try {
    const storage = getStorage();
    await Promise.all(keys.map((k) => storage.remove(k)));
  } catch {
    /* storage not configured or transient failure; orphans are swept in Phase 6 */
  }
}

// ---------- contacts ----------

async function requireClient(tx: Tx, actor: ActorLike, clientId: string) {
  const c = await tx.client.findFirst({ where: { AND: [{ id: clientId }, clientScope(actor)] }, select: { id: true } });
  if (!c) throw new NotFoundError("Client not found.");
}

export async function addContact(actor: ActorLike, clientId: string, raw: unknown) {
  assertCan(actor, "client:write");
  const input = contactInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await requireClient(tx, actor, clientId);
    const existing = await tx.contact.count({ where: { clientId } });
    const isPrimary = input.isPrimary || existing === 0;
    if (isPrimary) await tx.contact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    const c = await tx.contact.create({ data: { ...input, clientId, isPrimary } });
    await logActivity(tx, clientId, actor.id, "contact.added", `Contact added: ${c.firstName} ${c.lastName}`.trim());
    await audit({ actorId: actor.id, action: "contact.create", entity: "Contact", entityId: c.id }, tx);
    return c;
  });
}

export async function updateContact(actor: ActorLike, contactId: string, raw: unknown) {
  assertCan(actor, "client:write");
  const input: ContactInput = contactInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const existing = await tx.contact.findUnique({ where: { id: contactId }, select: { clientId: true } });
    if (!existing) throw new NotFoundError("Contact not found.");
    await requireClient(tx, actor, existing.clientId);
    if (input.isPrimary)
      await tx.contact.updateMany({ where: { clientId: existing.clientId }, data: { isPrimary: false } });
    const c = await tx.contact.update({ where: { id: contactId }, data: input });
    await logActivity(
      tx,
      existing.clientId,
      actor.id,
      "contact.updated",
      `Contact updated: ${c.firstName} ${c.lastName}`.trim(),
    );
    await audit({ actorId: actor.id, action: "contact.update", entity: "Contact", entityId: contactId }, tx);
    return c;
  });
}

export async function deleteContact(actor: ActorLike, contactId: string) {
  assertCan(actor, "client:write");
  await db.$transaction(async (tx) => {
    const c = await tx.contact.findUnique({ where: { id: contactId } });
    if (!c) throw new NotFoundError("Contact not found.");
    await requireClient(tx, actor, c.clientId);
    await tx.contact.delete({ where: { id: contactId } });
    await logActivity(
      tx,
      c.clientId,
      actor.id,
      "contact.removed",
      `Contact removed: ${c.firstName} ${c.lastName}`.trim(),
    );
    await audit({ actorId: actor.id, action: "contact.delete", entity: "Contact", entityId: contactId }, tx);
  });
}

// ---------- notes ----------

export async function addNote(actor: ActorLike, clientId: string, raw: unknown) {
  assertCan(actor, "client:write");
  const { body } = noteInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await requireClient(tx, actor, clientId);
    const n = await tx.note.create({ data: { clientId, authorId: actor.id, body } });
    await logActivity(tx, clientId, actor.id, "note.added", "Note added");
    await audit({ actorId: actor.id, action: "note.create", entity: "Note", entityId: n.id }, tx);
    return n;
  });
}

export async function deleteNote(actor: ActorLike, noteId: string) {
  assertCan(actor, "client:write");
  await db.$transaction(async (tx) => {
    const n = await tx.note.findUnique({ where: { id: noteId } });
    if (!n) throw new NotFoundError("Note not found.");
    await requireClient(tx, actor, n.clientId);
    await tx.note.delete({ where: { id: noteId } });
    await audit({ actorId: actor.id, action: "note.delete", entity: "Note", entityId: noteId }, tx);
  });
}

// ---------- CSV ----------

export async function exportClientsCsv(actor: ActorLike): Promise<string> {
  assertCan(actor, "client:export");
  const clients = await withRetry(() =>
    db.client.findMany({
      where: clientScope(actor),
      orderBy: { name: "asc" },
      include: { tags: { select: { tag: { select: { name: true } } } } },
    }),
  );
  const rows = clients.map((c) => ({
    name: c.name,
    status: c.status,
    website: c.website,
    industry: c.industry,
    email: c.email,
    phone: c.phone,
    address_line1: c.addressLine1,
    address_line2: c.addressLine2,
    city: c.city,
    state: c.state,
    postal_code: c.postalCode,
    country: c.country,
    billing_email: c.billingEmail,
    tax_rate_percent: c.taxRateBps == null ? "" : bpsToPercent(c.taxRateBps),
    tags: c.tags.map((t) => t.tag.name).join(", "),
  }));
  await audit({ actorId: actor.id, action: "client.export", entity: "Client", meta: { count: rows.length } });
  return toCsv(CLIENT_CSV_HEADERS, rows);
}

export type ImportResult = {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
  fatal?: string;
};

export async function importClientsCsv(actor: ActorLike, text: string): Promise<ImportResult> {
  assertCan(actor, "client:import");
  const parsed = parseCsv(text);
  if (parsed.error) return { created: 0, skipped: 0, errors: [], fatal: parsed.error };

  const errors: ImportResult["errors"] = [];
  const valid: (ClientInput & { taxRate: number | null })[] = [];
  const seen = new Set<string>();
  const existing = new Set((await db.client.findMany({ select: { name: true } })).map((c) => c.name.toLowerCase()));
  let skipped = 0;

  parsed.rows.forEach((row, i) => {
    const rowNo = i + 2; // header is row 1
    const res = clientInputSchema.safeParse(rowToClientInput(row));
    if (!res.success) {
      errors.push({ row: rowNo, message: res.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      return;
    }
    const key = res.data.name.toLowerCase();
    if (existing.has(key) || seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);
    valid.push(res.data as ClientInput & { taxRate: number | null });
  });

  let created = 0;
  for (let i = 0; i < valid.length; i += 25) {
    const chunk = valid.slice(i, i + 25);
    await db.$transaction(
      async (tx) => {
        for (const input of chunk) await createClientTx(tx, actor, input);
      },
      { timeout: 20_000 },
    );
    created += chunk.length;
  }
  await audit({
    actorId: actor.id,
    action: "client.import",
    entity: "Client",
    meta: { created, skipped, errors: errors.length },
  });
  return { created, skipped, errors };
}
