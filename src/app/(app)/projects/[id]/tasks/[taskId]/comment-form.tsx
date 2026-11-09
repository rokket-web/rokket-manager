"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/components/forms/field-form";

export function CommentForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <Label htmlFor="comment-body">Add a comment</Label>
      <Textarea id="comment-body" name="body" rows={3} required maxLength={5000} />
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.fieldErrors?.body?.join(" ") ?? state.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Comment"}
      </Button>
    </form>
  );
}
