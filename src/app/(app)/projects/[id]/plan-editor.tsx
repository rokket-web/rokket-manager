"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allocateInstallments, MAX_INSTALLMENTS } from "@/lib/installments";
import { formatCents } from "@/lib/money";
import { percentToBps } from "@/lib/tax";
import type { FormState } from "@/components/forms/field-form";

export type OpenRow = { id: string; label: string; percent: string };
export type LockedRow = { label: string; basisPoints: number; amountCents: number };

/**
 * Edits the installments that have not been invoiced. Invoiced ones are shown read-only above and counted toward 100%.
 * The preview is cosmetic: the server re-derives every amount.
 */
export function PlanEditor({
  action,
  feeCents,
  currency,
  locked,
  initial,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  feeCents: number;
  currency: string;
  locked: LockedRow[];
  initial: OpenRow[];
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const [rows, setRows] = useState<OpenRow[]>(initial);

  const view = useMemo(() => {
    const parsed = rows.map((r) => percentToBps(r.percent.replace(/%$/, "")));
    const lockedBps = locked.reduce((s, l) => s + l.basisPoints, 0);
    const total = lockedBps + parsed.reduce<number>((s, b) => s + (b ?? 0), 0);
    const alloc =
      parsed.every((b) => b !== null && b > 0)
        ? allocateInstallments(feeCents, [
            ...locked.map((l) => ({ basisPoints: l.basisPoints, lockedAmountCents: l.amountCents })),
            ...parsed.map((b) => ({ basisPoints: b as number })),
          ])
        : null;
    return { total, parsed, amounts: alloc && alloc.ok ? alloc.amounts.slice(locked.length) : null };
  }, [rows, locked, feeCents]);

  const set = (i: number, patch: Partial<OpenRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const balanced = view.total === 10000;

  return (
    <form action={formAction} className="space-y-3">
      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      {state.fieldErrors?.rows && (
        <p role="alert" className="text-destructive text-sm">
          {state.fieldErrors.rows.join(" ")}
        </p>
      )}
      {state.ok && !state.error && (
        <p role="status" className="text-sm">
          Plan saved.
        </p>
      )}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.id || `new-${i}`} className="grid grid-cols-[1fr_6rem_7rem_2rem] items-center gap-2">
            <input type="hidden" name="rowId" value={r.id} />
            <Input
              aria-label={`Installment ${locked.length + i + 1} label`}
              name="rowLabel"
              value={r.label}
              onChange={(e) => set(i, { label: e.target.value })}
              maxLength={120}
              required
            />
            <div className="flex items-center gap-1">
              <Input
                aria-label={`Installment ${locked.length + i + 1} percent`}
                name="rowPercent"
                inputMode="decimal"
                value={r.percent}
                onChange={(e) => set(i, { percent: e.target.value })}
                required
              />
              <span className="text-muted-foreground text-sm">%</span>
            </div>
            <span className="text-right text-sm tabular-nums">{view.amounts ? formatCents(view.amounts[i], currency) : "-"}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove installment ${locked.length + i + 1}`}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked.length + rows.length >= MAX_INSTALLMENTS}
          onClick={() => setRows((rs) => [...rs, { id: "", label: `Installment ${locked.length + rs.length + 1}`, percent: "" }])}
        >
          Add installment
        </Button>
        <span className={balanced ? "text-sm" : "text-destructive text-sm"} aria-live="polite">
          Total {view.total / 100}%{balanced ? "" : " (must be 100%)"}
        </span>
        <Button type="submit" className="ml-auto" disabled={pending}>
          {pending ? "Saving..." : "Save plan"}
        </Button>
      </div>
    </form>
  );
}
