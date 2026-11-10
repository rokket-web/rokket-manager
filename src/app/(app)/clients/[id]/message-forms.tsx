"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ENTER_HINT, enterToSend } from "@/components/messages/enter-to-send";
import type { FormState } from "../form-state";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Feedback({ state, field }: { state: FormState; field?: string }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {(field && state.fieldErrors?.[field]?.join(" ")) || state.error}
        </p>
      )}
      {state.ok && state.notice && (
        <p role="status" className="text-muted-foreground text-xs">
          {state.notice}
        </p>
      )}
    </>
  );
}

export function MessageForm({ action, disabled }: { action: Action; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <Label htmlFor="message-body">Message</Label>
      <Textarea
        id="message-body"
        name="body"
        rows={3}
        required
        maxLength={5000}
        disabled={disabled}
        onKeyDown={(e) => enterToSend(e, pending)}
      />
      <p className="text-muted-foreground text-xs">{ENTER_HINT}</p>
      <Feedback state={state} field="body" />
      <Button type="submit" size="sm" disabled={pending || disabled}>
        {pending ? "Sending..." : "Send message"}
      </Button>
    </form>
  );
}

export function EmailForm({ action, to }: { action: Action; to: string }) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <p className="text-muted-foreground text-xs">
        To: <span className="text-foreground">{to}</span>
      </p>
      <div className="space-y-1">
        <Label htmlFor="email-subject">Subject</Label>
        <Input id="email-subject" name="subject" required maxLength={150} defaultValue={state.values?.subject} />
        {state.fieldErrors?.subject && <p className="text-destructive text-xs">{state.fieldErrors.subject.join(" ")}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="email-body">Message</Label>
        <Textarea id="email-body" name="body" rows={8} required maxLength={10000} defaultValue={state.values?.body} />
        {state.fieldErrors?.body && <p className="text-destructive text-xs">{state.fieldErrors.body.join(" ")}</p>}
      </div>
      {state.error && !state.fieldErrors && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
      {state.ok && state.notice && (
        <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">
          {state.notice}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Sending..." : "Send email"}
      </Button>
    </form>
  );
}
