"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { computeTotals, parseQuantity } from "@/lib/billing";
import { dollarsToCents, formatCents } from "@/lib/money";
import { bpsToPercent } from "@/lib/tax";
import type { FormState } from "@/components/forms/field-form";

export type LineRow = { description: string; quantity: string; unitPrice: string; taxable: boolean };
export type ClientOpt = { id: string; name: string; taxRateBps: number };
export type ProjectOpt = { id: string; name: string; clientId: string };

const blank = (): LineRow => ({ description: "", quantity: "1", unitPrice: "", taxable: true });

/**
 * Shared quote/invoice editor. The totals shown are a preview only: the server recomputes every amount
 * from quantity x unit price and the client's tax rate, and ignores anything else.
 */
export function DocForm({
  kind,
  clients,
  projects,
  action,
  defaults,
  initialLines,
  lockClient,
  submitLabel,
  cancelHref,
}: {
  kind: "quote" | "invoice";
  clients: ClientOpt[];
  projects: ProjectOpt[];
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  initialLines?: LineRow[];
  lockClient?: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const uid = useId();
  const [clientId, setClientId] = useState(state.values?.clientId ?? defaults.clientId ?? "");
  const [lines, setLines] = useState<LineRow[]>(initialLines?.length ? initialLines : [blank()]);
  const client = clients.find((c) => c.id === clientId);
  const clientProjects = projects.filter((p) => p.clientId === clientId);
  const dateName = kind === "quote" ? "validUntil" : "dueDate";
  const err = (n: string) => state.fieldErrors?.[n]?.join(" ");
  const val = (n: string) => state.values?.[n] ?? defaults[n] ?? "";

  const totals = useMemo(() => {
    const parsed = lines.map((l) => ({
      quantityMilli: parseQuantity(l.quantity) ?? 0,
      unitPriceCents: dollarsToCents(l.unitPrice) ?? 0,
      taxable: l.taxable,
    }));
    return { ...computeTotals(parsed, client?.taxRateBps ?? 0), parsed };
  }, [lines, client]);

  const set = (i: number, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="max-w-4xl space-y-5">
      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-client`}>Client</Label>
          {lockClient ? (
            <>
              <input type="hidden" name="clientId" value={clientId} />
              <p className="h-9 py-2 text-sm">{client?.name}</p>
            </>
          ) : (
            <select
              id={`${uid}-client`}
              name="clientId"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="">Select a client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {err("clientId") && <p className="text-destructive text-xs">{err("clientId")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-project`}>Project (optional)</Label>
          <select
            id={`${uid}-project`}
            name="projectId"
            defaultValue={val("projectId")}
            key={clientId}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">None</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {err("projectId") && <p className="text-destructive text-xs">{err("projectId")}</p>}
        </div>
        {kind === "quote" && (
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-title`}>Title</Label>
            <Input id={`${uid}-title`} name="title" defaultValue={val("title")} maxLength={200} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-date`}>{kind === "quote" ? "Valid until" : "Due date"}</Label>
          <Input id={`${uid}-date`} name={dateName} type="date" defaultValue={val(dateName)} />
          <p className="text-muted-foreground text-xs">
            {kind === "quote" ? "Defaults to 30 days after sending." : "Defaults to net 30 from the send date."}
          </p>
          {err(dateName) && <p className="text-destructive text-xs">{err(dateName)}</p>}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Line items</legend>
        <div className="text-muted-foreground hidden grid-cols-[1fr_5rem_7rem_4.5rem_6rem_2rem] gap-2 text-xs sm:grid">
          <span>Description</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span>Taxable</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_7rem_4.5rem_6rem_2rem] sm:items-center">
            <Input
              aria-label={`Line ${i + 1} description`}
              name="lineDescription"
              value={l.description}
              onChange={(e) => set(i, { description: e.target.value })}
              placeholder="Description"
              maxLength={500}
              required
              className="col-span-2 sm:col-span-1"
            />
            <Input
              aria-label={`Line ${i + 1} quantity`}
              name="lineQuantity"
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => set(i, { quantity: e.target.value })}
              required
            />
            <Input
              aria-label={`Line ${i + 1} unit price`}
              name="lineUnitPrice"
              inputMode="decimal"
              placeholder="0.00"
              value={l.unitPrice}
              onChange={(e) => set(i, { unitPrice: e.target.value })}
              required
            />
            <select
              aria-label={`Line ${i + 1} taxable`}
              name="lineTaxable"
              value={l.taxable ? "true" : "false"}
              onChange={(e) => set(i, { taxable: e.target.value === "true" })}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
            <span className="text-right text-sm tabular-nums">{formatCents(totals.lineAmounts[i] ?? 0)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove line ${i + 1}`}
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          </div>
        ))}
        {err("lines") && <p className="text-destructive text-xs">{err("lines")}</p>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={lines.length >= 100}
          onClick={() => setLines((ls) => [...ls, blank()])}
        >
          Add line
        </Button>
      </fieldset>

      <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{formatCents(totals.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Tax{client ? ` (${bpsToPercent(client.taxRateBps)}%)` : ""}</dt>
          <dd className="tabular-nums">{formatCents(totals.taxCents)}</dd>
        </div>
        <div className="flex justify-between border-t pt-1 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatCents(totals.totalCents)}</dd>
        </div>
        <p className="text-muted-foreground text-xs">Preview. Final amounts are calculated when you save.</p>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-notes`}>Notes</Label>
          <Textarea id={`${uid}-notes`} name="notes" rows={4} defaultValue={val("notes")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-terms`}>Terms</Label>
          <Textarea id={`${uid}-terms`} name="terms" rows={4} defaultValue={val("terms")} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
