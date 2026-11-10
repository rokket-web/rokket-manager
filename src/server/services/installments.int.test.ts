import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { ActorLike } from "@/server/authz/clients";
import * as installments from "./installments";
import * as invoices from "./invoices";
import * as payments from "./payments";
import * as projects from "./projects";

const P = `ZZTEST-${Math.random().toString(36).slice(2, 8)}`;
let admin: ActorLike;
let staff: ActorLike;
let clientId: string;

const newProject = (name: string, extra: Record<string, string> = {}) =>
  projects.createProject(admin, { clientId, name: `${P} ${name}`, status: "ACTIVE", billingType: "FLAT_FEE", flatFee: "10000", ...extra });
const plan = (id: string) => installments.getBillingPlan(admin, id);
const amounts = async (id: string) => (await plan(id)).installments.map((i) => i.amountCents);
const rows = (...r: [string, string, string?][]) => ({ rows: r.map(([label, percent, id]) => ({ id: id ?? "", label, percent })) });

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@rokket.test" } });
  const s = await db.user.findUniqueOrThrow({ where: { email: "staff@rokket.test" } });
  admin = { id: a.id, role: "ADMIN" };
  staff = { id: s.id, role: "STAFF" };
  clientId = (await db.client.create({ data: { name: `${P} Client`, taxRateBps: 825 } })).id;
});
afterAll(async () => {
  const touched = [
    ...(await db.project.findMany({ where: { clientId }, select: { id: true } })),
    ...(await db.invoice.findMany({ where: { clientId }, select: { id: true } })),
  ].map((x) => x.id);
  await db.payment.deleteMany({ where: { invoice: { clientId } } });
  await db.invoice.deleteMany({ where: { clientId } });
  await db.project.deleteMany({ where: { clientId } });
  await db.auditLog.deleteMany({ where: { entityId: { in: touched } } });
  await db.activity.deleteMany({ where: { clientId } });
  await db.client.deleteMany({ where: { id: clientId } });
  await db.$disconnect();
});

describe("billing type on projects", () => {
  it("requires a fee for flat-fee projects and ignores one for hourly projects", async () => {
    await expect(newProject("NoFee", { flatFee: "" })).rejects.toBeInstanceOf(ZodError);
    await expect(newProject("TooBig", { flatFee: "99999999999" })).rejects.toBeInstanceOf(ZodError);
    const h = await projects.createProject(admin, { clientId, name: `${P} Hourly`, billingType: "HOURLY", flatFee: "5000" });
    expect(h).toMatchObject({ billingType: "HOURLY", flatFeeCents: null });
    const f = await newProject("Flat", { flatFee: "12000.50" });
    expect(f).toMatchObject({ billingType: "FLAT_FEE", flatFeeCents: 1200050 });
  });

  it("hides the flat fee from staff", async () => {
    const f = await newProject("StaffView");
    await projects.setProjectMembers(admin, f.id, [staff.id]);
    expect((await projects.getProject(admin, f.id)).flatFeeCents).toBe(1000000);
    expect((await projects.getProject(staff, f.id)).flatFeeCents).toBeNull();
    expect((await projects.listProjects(staff, {})).items.find((p) => p.id === f.id)!.flatFeeCents).toBeNull();
  });
});

describe("create standard billing (40/40/20)", () => {
  it("makes three cent-exact installments", async () => {
    const f = await newProject("Std", { flatFee: "10000.01" });
    await installments.createStandardBilling(admin, f.id);
    const p = await plan(f.id);
    expect(p.installments.map((i) => [i.label, i.basisPoints, i.amountCents])).toEqual([
      ["Installment 1 of 3", 4000, 400000],
      ["Installment 2 of 3", 4000, 400000],
      ["Installment 3 of 3", 2000, 200001],
    ]);
    expect(p.installments.reduce((s, i) => s + i.amountCents, 0)).toBe(1000001);
    await expect(installments.createStandardBilling(admin, f.id)).rejects.toBeInstanceOf(ConflictError); // only once
  });

  it("refuses hourly projects, and non-admins", async () => {
    const h = await projects.createProject(admin, { clientId, name: `${P} H2`, billingType: "HOURLY" });
    await expect(installments.createStandardBilling(admin, h.id)).rejects.toBeInstanceOf(ConflictError);
    const f = await newProject("Perm");
    await expect(installments.createStandardBilling(staff, f.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(installments.savePlan(staff, f.id, rows(["a", "100"]))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(installments.getBillingPlan(staff, f.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(installments.createStandardBilling(admin, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("adjusting the plan", () => {
  it("changes percentages, count and labels while keeping the total at 100%", async () => {
    const f = await newProject("Adj", { flatFee: "10000" });
    await installments.createStandardBilling(admin, f.id);
    const ids = (await plan(f.id)).installments.map((i) => i.id);
    // 50 / 50: drop the third, edit the first two
    await installments.savePlan(admin, f.id, rows(["Deposit", "50", ids[0]], ["Final", "50", ids[1]]));
    let p = await plan(f.id);
    expect(p.installments.map((i) => [i.label, i.amountCents])).toEqual([["Deposit", 500000], ["Final", 500000]]);
    // five parts, new ones appended
    await installments.savePlan(admin, f.id, rows(["A", "20", ids[0]], ["B", "20", ids[1]], ["C", "20"], ["D", "20"], ["E", "20"]));
    p = await plan(f.id);
    expect(p.installments.map((i) => i.label)).toEqual(["A", "B", "C", "D", "E"]);
    expect(p.installments.map((i) => i.position)).toEqual([0, 1, 2, 3, 4]);
    expect(await amounts(f.id)).toEqual([200000, 200000, 200000, 200000, 200000]);
    // uneven: remainder lands on the last
    await installments.savePlan(admin, f.id, rows(["A", "33.33", ids[0]], ["B", "33.33", ids[1]], ["C", "33.34"]));
    expect(await amounts(f.id)).toEqual([333300, 333300, 333400]);
  });

  it("rejects totals other than 100%, bad input and foreign or duplicate ids", async () => {
    const f = await newProject("Bad");
    await installments.createStandardBilling(admin, f.id);
    const ids = (await plan(f.id)).installments.map((i) => i.id);
    await expect(installments.savePlan(admin, f.id, rows(["a", "50", ids[0]], ["b", "40", ids[1]]))).rejects.toThrow(/100%/);
    await expect(installments.savePlan(admin, f.id, rows(["a", "60", ids[0]], ["b", "60", ids[1]]))).rejects.toBeInstanceOf(ZodError);
    await expect(installments.savePlan(admin, f.id, rows(["a", "0", ids[0]], ["b", "100", ids[1]]))).rejects.toBeInstanceOf(ZodError);
    await expect(installments.savePlan(admin, f.id, rows(["", "100", ids[0]]))).rejects.toBeInstanceOf(ZodError);
    await expect(installments.savePlan(admin, f.id, rows(["a", "50", ids[0]], ["b", "50", ids[0]]))).rejects.toBeInstanceOf(ZodError);
    await expect(installments.savePlan(admin, f.id, { rows: [] })).rejects.toBeInstanceOf(ZodError);
    const other = await newProject("Other");
    await installments.createStandardBilling(admin, other.id);
    const foreign = (await plan(other.id)).installments[0].id;
    await expect(installments.savePlan(admin, f.id, rows(["a", "100", foreign]))).rejects.toBeInstanceOf(NotFoundError);
    expect(await amounts(f.id)).toEqual([400000, 400000, 200000]); // unchanged by every failed attempt
  });

  it("removes the plan only while nothing is invoiced", async () => {
    const f = await newProject("Clear");
    await installments.createStandardBilling(admin, f.id);
    await installments.clearPlan(admin, f.id);
    expect((await plan(f.id)).installments).toHaveLength(0);
    await installments.createStandardBilling(admin, f.id);
    const first = (await plan(f.id)).installments[0];
    await installments.createInvoiceFromInstallment(admin, first.id);
    await expect(installments.clearPlan(admin, f.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("invoicing an installment", () => {
  it("creates a draft at the stored amount plus the client's tax, once", async () => {
    const f = await newProject("Inv", { flatFee: "10000" });
    await installments.createStandardBilling(admin, f.id);
    const [i1, i2] = (await plan(f.id)).installments;
    const inv = await installments.createInvoiceFromInstallment(admin, i1.id);
    expect(inv).toMatchObject({ status: "DRAFT", projectId: f.id, clientId, subtotalCents: 400000, taxCents: 33000, totalCents: 433000, taxRateBps: 825 });
    const full = await invoices.getInvoice(admin, inv.id);
    expect(full.lines).toHaveLength(1);
    expect(full.lines[0].description).toContain("Installment 1 of 3");
    expect(full.lines[0].description).toContain("40%");
    expect((await plan(f.id)).installments[0].invoice!.id).toBe(inv.id);
    await expect(installments.createInvoiceFromInstallment(admin, i1.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(installments.createInvoiceFromInstallment(staff, i2.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(installments.createInvoiceFromInstallment(admin, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets only one of two simultaneous requests create the invoice", async () => {
    const f = await newProject("Race");
    await installments.createStandardBilling(admin, f.id);
    const [i1] = (await plan(f.id)).installments;
    const r = await Promise.allSettled([
      installments.createInvoiceFromInstallment(admin, i1.id),
      installments.createInvoiceFromInstallment(admin, i1.id),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.invoice.count({ where: { projectId: f.id } })).toBe(1);
  });

  it("frees the installment when its draft is deleted or its invoice is voided", async () => {
    const f = await newProject("Free");
    await installments.createStandardBilling(admin, f.id);
    const [i1, i2] = (await plan(f.id)).installments;
    const d = await installments.createInvoiceFromInstallment(admin, i1.id);
    await invoices.deleteDraftInvoice(admin, d.id);
    expect((await plan(f.id)).installments[0].invoice).toBeNull();
    const again = await installments.createInvoiceFromInstallment(admin, i1.id);
    await invoices.markInvoiceSent(admin, again.id);
    await invoices.voidInvoice(admin, again.id);
    expect((await plan(f.id)).installments[0].invoice).toBeNull();
    expect((await plan(f.id)).installments[0].amountCents).toBe(i1.amountCents); // amount unchanged
    await installments.createInvoiceFromInstallment(admin, i2.id); // and others remain independent
  });

  it("tracks invoiced and paid totals across the plan", async () => {
    const f = await newProject("Totals", { flatFee: "1000" });
    await installments.createStandardBilling(admin, f.id);
    const [i1] = (await plan(f.id)).installments;
    const d = await installments.createInvoiceFromInstallment(admin, i1.id);
    await invoices.markInvoiceSent(admin, d.id);
    await payments.recordManualPayment(admin, d.id, { amount: "100" });
    const p = await plan(f.id);
    expect(p.invoicedCents).toBe(43300); // $400 + 8.25% tax
    expect(p.paidCents).toBe(10000);
  });

  it("reshapes only the uninvoiced part once billing has started, keeping invoiced amounts fixed", async () => {
    const f = await newProject("Partial", { flatFee: "10000" });
    await installments.createStandardBilling(admin, f.id);
    const [i1, i2, i3] = (await plan(f.id)).installments;
    await installments.createInvoiceFromInstallment(admin, i1.id);
    // the first 40% is locked; split the remaining 60% as 30 / 30
    await installments.savePlan(admin, f.id, rows(["Middle", "30", i2.id], ["End", "30", i3.id]));
    expect(await amounts(f.id)).toEqual([400000, 300000, 300000]);
    // a locked installment cannot be edited or omitted-and-deleted
    await expect(installments.savePlan(admin, f.id, rows(["Hack", "100", i1.id]))).rejects.toBeInstanceOf(ConflictError);
    expect((await plan(f.id)).installments).toHaveLength(3);
    // total must still reach 100% counting the locked 40%
    await expect(installments.savePlan(admin, f.id, rows(["Rest", "70", i2.id]))).rejects.toThrow(/100%/);
    await installments.savePlan(admin, f.id, rows(["Rest", "60", i2.id]));
    expect((await plan(f.id)).installments.map((i) => [i.label, i.amountCents])).toEqual([["Installment 1 of 3", 400000], ["Rest", 600000]]);
  });
});

describe("changing the project's billing after the plan exists", () => {
  const edit = (id: string, extra: Record<string, string>) => projects.updateProject(admin, id, { name: `${P} edit`, status: "ACTIVE", ...extra });

  it("re-derives installment amounts when the fee changes before any invoice", async () => {
    const f = await newProject("Fee", { flatFee: "10000" });
    await installments.createStandardBilling(admin, f.id);
    await edit(f.id, { billingType: "FLAT_FEE", flatFee: "20000" });
    expect(await amounts(f.id)).toEqual([800000, 800000, 400000]);
  });

  it("drops the plan when switching to hourly before any invoice", async () => {
    const f = await newProject("ToHourly");
    await installments.createStandardBilling(admin, f.id);
    await edit(f.id, { billingType: "HOURLY" });
    expect((await plan(f.id)).installments).toHaveLength(0);
    expect(await db.project.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ billingType: "HOURLY", flatFeeCents: null });
  });

  it("blocks changing type or fee once an installment has been invoiced, but allows other edits", async () => {
    const f = await newProject("Locked", { flatFee: "10000" });
    await installments.createStandardBilling(admin, f.id);
    await installments.createInvoiceFromInstallment(admin, (await plan(f.id)).installments[0].id);
    await expect(edit(f.id, { billingType: "FLAT_FEE", flatFee: "20000" })).rejects.toBeInstanceOf(ConflictError);
    await expect(edit(f.id, { billingType: "HOURLY" })).rejects.toBeInstanceOf(ConflictError);
    await edit(f.id, { billingType: "FLAT_FEE", flatFee: "10000", description: "still editable" });
    expect((await projects.getProject(admin, f.id)).description).toBe("still editable");
    expect(await amounts(f.id)).toEqual([400000, 400000, 200000]);
  });
});

describe("hourly invoicing is separate", () => {
  it("refuses to invoice time on a flat-fee project", async () => {
    const f = await newProject("NoTime");
    await expect(invoices.createInvoiceFromTime(admin, { projectId: f.id })).rejects.toThrow(/flat-fee/);
  });
});
