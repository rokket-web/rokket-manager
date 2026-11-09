"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "./form-state";

export type ClientFormValues = Record<string, string>;

function Field({
  name,
  label,
  state,
  defaults,
  type = "text",
  hint,
  required,
}: {
  name: string;
  label: string;
  state: FormState;
  defaults: ClientFormValues;
  type?: string;
  hint?: string;
  required?: boolean;
}) {
  const errs = state.fieldErrors?.[name];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={state.values?.[name] ?? defaults[name] ?? ""}
        aria-invalid={!!errs}
        aria-describedby={errs ? `${name}-err` : undefined}
      />
      {hint && !errs && <p className="text-muted-foreground text-xs">{hint}</p>}
      {errs && (
        <p id={`${name}-err`} className="text-destructive text-xs">
          {errs.join(" ")}
        </p>
      )}
    </div>
  );
}

export function ClientForm({
  action,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaults: ClientFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const status = state.values?.status ?? defaults.status ?? "LEAD";
  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field name="name" label="Company name" state={state} defaults={defaults} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="LEAD">Lead</option>
            <option value="ACTIVE">Active</option>
            <option value="PAST">Past</option>
          </select>
        </div>
        <Field name="industry" label="Industry" state={state} defaults={defaults} />
        <Field name="email" label="Email" type="email" state={state} defaults={defaults} />
        <Field name="phone" label="Phone" state={state} defaults={defaults} />
        <Field name="website" label="Website" state={state} defaults={defaults} />
        <Field name="billingEmail" label="Billing email" type="email" state={state} defaults={defaults} />
        <Field
          name="taxRate"
          label="Tax rate (%)"
          state={state}
          defaults={defaults}
          hint="Leave blank to use the default rate. Enter 0 for tax-exempt."
        />
        <Field
          name="tags"
          label="Tags"
          state={state}
          defaults={defaults}
          hint="Comma-separated, e.g. wordpress, retainer"
        />
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Address</legend>
        <div className="sm:col-span-2">
          <Field name="addressLine1" label="Address line 1" state={state} defaults={defaults} />
        </div>
        <div className="sm:col-span-2">
          <Field name="addressLine2" label="Address line 2" state={state} defaults={defaults} />
        </div>
        <Field name="city" label="City" state={state} defaults={defaults} />
        <Field name="state" label="State / region" state={state} defaults={defaults} />
        <Field name="postalCode" label="Postal code" state={state} defaults={defaults} />
        <Field name="country" label="Country" state={state} defaults={defaults} />
      </fieldset>
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
