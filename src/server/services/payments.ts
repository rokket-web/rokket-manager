import { balanceCents, statusAfterPayment } from "@/lib/billing";
import { audit } from "@/server/audit";
import type { ActorLike } from "@/server/authz/clients";
import { assertBilling } from "@/server/authz/billing";
import { db } from "@/server/db";
import { ConflictError, NotFoundError } from "@/server/errors";
import { manualPaymentSchema } from "@/lib/validation/billing";
import { formatCents } from "@/lib/money";
import { logClientActivity, type Tx } from "./billing-core";

/**
 * Recompute paidCents/status/paidAt from SUCCEEDED payments. The single place invoice payment state changes,
 * shared by manual payments and the Stripe webhook. Locks the invoice row so concurrent payments serialize.
 */
export async function recomputeInvoicePayments(tx: Tx, invoiceId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new NotFoundError("Invoice not found.");
  const agg = await tx.payment.aggregate({
    where: { invoiceId, status: "SUCCEEDED" },
    _sum: { amountCents: true },
  });
  const paidCents = agg._sum.amountCents ?? 0;
  const status = statusAfterPayment({ status: inv.status, totalCents: inv.totalCents, paidCents, dueDate: inv.dueDate });
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { paidCents, status, paidAt: status === "PAID" ? (inv.paidAt ?? new Date()) : null },
  });
}

export async function recordManualPayment(actor: ActorLike, invoiceId: string, raw: unknown) {
  assertBilling(actor, "billing:write");
  const input = manualPaymentSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundError("Invoice not found.");
    if (inv.status !== "SENT" && inv.status !== "PARTIALLY_PAID") {
      throw new ConflictError("Payments can only be recorded on a sent, unpaid invoice.");
    }
    if (input.amount > balanceCents(inv)) throw new ConflictError("That is more than the balance due.");
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        method: "MANUAL",
        status: "SUCCEEDED",
        amountCents: input.amount,
        currency: inv.currency,
        reference: input.reference,
        paidAt: input.paidAt ?? new Date(),
      },
    });
    const updated = await recomputeInvoicePayments(tx, invoiceId);
    await logClientActivity(
      tx,
      inv.clientId,
      actor.id,
      "invoice.payment",
      `Recorded ${formatCents(input.amount, inv.currency)} payment on ${inv.number}`,
    );
    await audit(
      {
        actorId: actor.id,
        action: "payment.manual",
        entity: "Invoice",
        entityId: invoiceId,
        meta: { paymentId: payment.id, amountCents: input.amount, status: updated.status },
      },
      tx,
    );
    return { payment, invoice: updated };
  });
}
