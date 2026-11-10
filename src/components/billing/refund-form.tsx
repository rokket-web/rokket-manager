"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/components/forms/field-form";

/** Inline two-step refund for one card payment. Stripe validates the amount; its message is shown on error. */
export function RefundForm({
  action,
  defaultAmount,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaultAmount: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(true)}>
        Refund
      </Button>
    );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Input
        name="amount"
        aria-label="Refund amount (USD)"
        defaultValue={state.values?.amount ?? defaultAmount}
        inputMode="decimal"
        className="h-8 w-24"
        required
      />
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {pending ? "Refunding..." : "Confirm refund"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
      {state.error && (
        <span role="alert" className="text-destructive w-full text-xs">
          {state.error}
        </span>
      )}
      {state.ok && !state.error && <span className="text-xs">Refunded.</span>}
    </form>
  );
}
