"use client";

import { useActionState, useId } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type FormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export type Field = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "date" | "number" | "select" | "checkbox" | "email";
  options?: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
  wide?: boolean;
  min?: number;
  max?: number;
};

/** Generic server-action form: renders fields, shows per-field errors, keeps typed values on error. */
export function FieldForm({
  fields,
  action,
  defaults = {},
  submitLabel,
  cancelHref,
  className = "",
}: {
  fields: Field[];
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaults?: Record<string, string>;
  submitLabel: string;
  cancelHref?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const uid = useId(); // unique per form instance, so two forms on one page never share field ids
  return (
    <form action={formAction} className={`grid gap-4 sm:grid-cols-2 ${className}`}>
      {state.error && (
        <p role="alert" className="text-destructive text-sm sm:col-span-2">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p role="status" className="text-sm sm:col-span-2">
          Saved.
        </p>
      )}
      {fields.map((f) => {
        const errs = state.fieldErrors?.[f.name];
        const value = state.values?.[f.name] ?? defaults[f.name] ?? "";
        const id = `${uid}-${f.name}`;
        const common = { id, name: f.name, "aria-invalid": !!errs, "aria-describedby": errs ? `${id}-err` : undefined };
        return (
          <div key={f.name} className={`space-y-1.5 ${f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}`}>
            {f.type === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={f.name}
                  defaultChecked={(state.values ? state.values[f.name] : defaults[f.name]) === "on" || value === "true"}
                />{" "}
                {f.label}
              </label>
            ) : (
              <>
                <Label htmlFor={id}>{f.label}</Label>
                {f.type === "textarea" ? (
                  <Textarea {...common} rows={4} defaultValue={value} required={f.required} />
                ) : f.type === "select" ? (
                  <select
                    {...common}
                    defaultValue={value}
                    required={f.required}
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    {...common}
                    type={f.type ?? "text"}
                    defaultValue={value}
                    required={f.required}
                    min={f.min}
                    max={f.max}
                  />
                )}
              </>
            )}
            {f.hint && !errs && <p className="text-muted-foreground text-xs">{f.hint}</p>}
            {errs && (
              <p id={`${id}-err`} className="text-destructive text-xs">
                {errs.join(" ")}
              </p>
            )}
          </div>
        );
      })}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
        {cancelHref && (
          <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
