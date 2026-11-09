"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "../form-state";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type Defaults = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  isPrimary?: boolean;
};

export function ContactForm({
  action,
  defaults = {},
  submitLabel,
  resetOnSuccess,
}: {
  action: Action;
  defaults?: Defaults;
  submitLabel: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const err = (n: string) => state.fieldErrors?.[n]?.join(" ");
  const val = (n: keyof Defaults) => state.values?.[n] ?? (defaults[n] as string | undefined) ?? "";
  return (
    <form ref={ref} action={formAction} className="grid gap-3 sm:grid-cols-2">
      {state.error && (
        <p role="alert" className="text-destructive text-sm sm:col-span-2">
          {state.error}
        </p>
      )}
      {(["firstName", "lastName", "email", "phone", "title"] as const).map((n) => (
        <div key={n} className="space-y-1">
          <Label htmlFor={`${n}-${defaults.email ?? "new"}`}>
            {{ firstName: "First name", lastName: "Last name", email: "Email", phone: "Phone", title: "Title" }[n]}
          </Label>
          <Input
            id={`${n}-${defaults.email ?? "new"}`}
            name={n}
            defaultValue={val(n)}
            required={n === "firstName"}
            type={n === "email" ? "email" : "text"}
          />
          {err(n) && <p className="text-destructive text-xs">{err(n)}</p>}
        </div>
      ))}
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="isPrimary" defaultChecked={!!defaults.isPrimary} /> Primary contact
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function NoteForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <Label htmlFor="note-body">Add an internal note</Label>
      <Textarea id="note-body" name="body" rows={3} required maxLength={5000} />
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.fieldErrors?.body?.join(" ") ?? state.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Add note"}
      </Button>
    </form>
  );
}
