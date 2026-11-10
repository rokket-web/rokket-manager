import { z } from "zod";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";
import { db, withRetry } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";
import { allocateInstallments, standardLabel, STANDARD_SPLIT_BPS, totalBps } from "@/lib/installments";
import { formatCents } from "@/lib/money";
import { bpsToPercent } from "@/lib/tax";
import { planInputSchema } from "@/lib/validation/installments";
import { buildLines, logClientActivity, resolveTaxRateBps, type Tx } from "./billing-core";

/** Serialize plan edits per project so two admins (or a double click) cannot interleave. */
async function lockProject(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
  const p = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, clientId: true, currency: true, billingType: true, flatFeeCents: true },
  });
  if (!p) throw new NotFoundError("Project not found.");
  return p;
}

function requireFlatFee(p: { billingType: string; flatFeeCents: number | null }): number {
  if (p.billingType !== "FLAT_FEE" || !p.flatFeeCents || p.flatFeeCents <= 0) {
    throw new ConflictError("This is not a flat-fee project. Set it to flat fee and enter the fee first.");
  }
  return p.flatFeeCents;
}

const fieldError = (message: string) =>
  new z.ZodError([{ code: "custom", path: ["rows"], message, input: undefined }]);

// ---------- read ----------

export async function getBillingPlan(actor: ActorLike, projectId: string) {
  assertBilling(actor, "billing:read");
  const p = await withRetry(() =>
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        currency: true,
        billingType: true,
        flatFeeCents: true,
        installments: {
          orderBy: { position: "asc" },
          include: { invoice: { select: { id: true, number: true, status: true, totalCents: true, paidCents: true } } },
        },
      },
    }),
  );
  if (!p) throw new NotFoundError("Project not found.");
  const invoiced = p.installments.filter((i) => i.invoice && i.invoice.status !== "VOID");
  return {
    ...p,
    invoicedCents: invoiced.reduce((s, i) => s + i.invoice!.totalCents, 0),
    paidCents: invoiced.reduce((s, i) => s + i.invoice!.paidCents, 0),
  };
}

// ---------- standard plan ----------

/** "Create standard billing": 40% / 40% / 20% of the flat fee, cent-exact. */
export async function createStandardBilling(actor: ActorLike, projectId: string) {
  assertBilling(actor, "billing:write");
  return db.$transaction(async (tx) => {
    const p = await lockProject(tx, projectId);
    const fee = requireFlatFee(p);
    if (await tx.billingInstallment.count({ where: { projectId } })) {
      throw new ConflictError("This project already has a billing plan. Edit it instead.");
    }
    const alloc = allocateInstallments(fee, STANDARD_SPLIT_BPS.map((basisPoints) => ({ basisPoints })));
    if (!alloc.ok) throw new ConflictError(alloc.error);
    await tx.billingInstallment.createMany({
      data: STANDARD_SPLIT_BPS.map((basisPoints, i) => ({
        projectId,
        position: i,
        label: standardLabel(i, STANDARD_SPLIT_BPS.length),
        basisPoints,
        amountCents: alloc.amounts[i],
      })),
    });
    await logClientActivity(tx, p.clientId, actor.id, "billing.plan", `Standard billing created for ${p.name} (40% / 40% / 20% of ${formatCents(fee, p.currency)})`);
    await audit({ actorId: actor.id, action: "billing.plan.standard", entity: "Project", entityId: projectId, meta: { feeCents: fee } }, tx);
  });
}

// ---------- edit the plan ----------

/**
 * Replace the NOT-yet-invoiced part of the plan. `rows` are the open installments (existing ids to keep/change,
 * blank id for new). Open installments left out are deleted. Invoiced installments are locked and untouched; the
 * whole plan must still total 100% and amounts are re-derived with the remainder on the last open installment.
 */
export async function savePlan(actor: ActorLike, projectId: string, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = planInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const p = await lockProject(tx, projectId);
    const fee = requireFlatFee(p);
    const current = await tx.billingInstallment.findMany({ where: { projectId }, orderBy: { position: "asc" } });
    const byId = new Map(current.map((c) => [c.id, c]));
    const locked = current.filter((c) => c.invoiceId);

    const seen = new Set<string>();
    for (const r of input.rows) {
      if (!r.id) continue;
      const existing = byId.get(r.id);
      if (!existing) throw new NotFoundError("That installment no longer exists. Reload and try again.");
      if (existing.invoiceId) throw new ConflictError("An installment that has been invoiced can't be edited.");
      if (seen.has(r.id)) throw fieldError("An installment appears twice.");
      seen.add(r.id);
    }

    // Final order: kept rows by their current position, new rows at the end in the order submitted; locked rows keep theirs.
    const open = [
      ...input.rows.filter((r) => r.id).sort((a, b) => byId.get(a.id!)!.position - byId.get(b.id!)!.position),
      ...input.rows.filter((r) => !r.id),
    ];
    const merged = [
      ...locked.map((l) => ({ sort: l.position, kind: "locked" as const, row: l })),
      ...open.map((r, i) => ({ sort: r.id ? byId.get(r.id)!.position : Number.MAX_SAFE_INTEGER - 100 + i, kind: "open" as const, row: r })),
    ].sort((a, b) => a.sort - b.sort);
    if (merged.length === 0) throw fieldError("Add at least one installment, or remove the plan.");

    const alloc = allocateInstallments(
      fee,
      merged.map((m) =>
        m.kind === "locked"
          ? { basisPoints: m.row.basisPoints, lockedAmountCents: m.row.amountCents }
          : { basisPoints: m.row.percent },
      ),
    );
    if (!alloc.ok) throw fieldError(alloc.error);

    // Delete open installments that were removed, then park survivors at high positions to dodge ordering conflicts.
    await tx.billingInstallment.deleteMany({
      where: { projectId, invoiceId: null, id: { notIn: [...seen] } },
    });
    for (const [n, m] of merged.entries()) {
      if (m.kind === "locked") {
        await tx.billingInstallment.update({ where: { id: m.row.id }, data: { position: n } });
      } else if (m.row.id) {
        await tx.billingInstallment.update({
          where: { id: m.row.id },
          data: { position: n, label: m.row.label, basisPoints: m.row.percent, amountCents: alloc.amounts[n] },
        });
      } else {
        await tx.billingInstallment.create({
          data: { projectId, position: n, label: m.row.label, basisPoints: m.row.percent, amountCents: alloc.amounts[n] },
        });
      }
    }
    await logClientActivity(tx, p.clientId, actor.id, "billing.plan", `Billing plan updated for ${p.name} (${merged.length} installments)`);
    await audit(
      { actorId: actor.id, action: "billing.plan.update", entity: "Project", entityId: projectId, meta: { installments: merged.length, bps: totalBps(merged.map((m) => ({ basisPoints: m.kind === "locked" ? m.row.basisPoints : m.row.percent }))) } },
      tx,
    );
  });
}

/** Remove the plan. Only possible while nothing has been invoiced. */
export async function clearPlan(actor: ActorLike, projectId: string) {
  assertBilling(actor, "billing:write");
  await db.$transaction(async (tx) => {
    const p = await lockProject(tx, projectId);
    if (await tx.billingInstallment.count({ where: { projectId, invoiceId: { not: null } } })) {
      throw new ConflictError("Some installments have been invoiced. Void those invoices before removing the plan.");
    }
    const n = await tx.billingInstallment.deleteMany({ where: { projectId } });
    await logClientActivity(tx, p.clientId, actor.id, "billing.plan", `Billing plan removed from ${p.name}`);
    await audit({ actorId: actor.id, action: "billing.plan.clear", entity: "Project", entityId: projectId, meta: { removed: n.count } }, tx);
  });
}

// ---------- invoicing an installment ----------

/** Draft invoice for one installment, at its stored amount. The installment is claimed atomically, so it is billed once. */
export async function createInvoiceFromInstallment(actor: ActorLike, installmentId: string) {
  assertBilling(actor, "billing:write");
  return db.$transaction(async (tx) => {
    const inst = await tx.billingInstallment.findUnique({ where: { id: installmentId }, select: { projectId: true } });
    if (!inst) throw new NotFoundError("Installment not found.");
    const p = await lockProject(tx, inst.projectId);
    const fee = requireFlatFee(p);
    const row = await tx.billingInstallment.findUnique({ where: { id: installmentId } });
    if (!row) throw new NotFoundError("Installment not found.");
    if (row.invoiceId) throw new ConflictError("This installment has already been invoiced.");

    const calc = buildLines(
      [{ description: `${p.name}: ${row.label} (${bpsToPercent(row.basisPoints)}% of ${formatCents(fee, p.currency)} flat fee)`.slice(0, 500), quantity: 1000, unitPrice: row.amountCents, taxable: true }],
      await resolveTaxRateBps(tx, p.clientId),
    );
    const inv = await tx.invoice.create({
      data: {
        clientId: p.clientId,
        projectId: p.id,
        currency: p.currency,
        taxRateBps: calc.taxRateBps,
        subtotalCents: calc.subtotalCents,
        taxCents: calc.taxCents,
        totalCents: calc.totalCents,
      },
    });
    await tx.invoiceLine.createMany({ data: calc.rows.map((r) => ({ ...r, invoiceId: inv.id })) });
    const claimed = await tx.billingInstallment.updateMany({ where: { id: installmentId, invoiceId: null }, data: { invoiceId: inv.id } });
    if (claimed.count === 0) throw new ConflictError("This installment has already been invoiced.");
    await logClientActivity(tx, p.clientId, actor.id, "invoice.created", `Draft invoice created for ${p.name}: ${row.label} (${formatCents(calc.totalCents, p.currency)})`);
    await audit({ actorId: actor.id, action: "invoice.create", entity: "Invoice", entityId: inv.id, meta: { installmentId, projectId: p.id } }, tx);
    return inv;
  });
}
