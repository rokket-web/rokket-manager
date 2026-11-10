"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/app/(app)/clients/form-state";

export function PortalMessageForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <Label htmlFor="portal-message-body">Write a message</Label>
      <Textarea id="portal-message-body" name="body" rows={4} required maxLength={5000} />
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.fieldErrors?.body?.join(" ") ?? state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send"}
      </Button>
    </form>
  );
}
