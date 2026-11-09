"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/components/forms/field-form";
import { startTimerAction } from "../../../actions";

export function StartTimerButton({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [state, action, pending] = useActionState(startTimerAction, {} as FormState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="billable" value="on" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Start timer
      </Button>
      {state.ok && (
        <span role="status" className="text-sm">
          Timer started.
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-destructive text-sm">
          {state.error}
        </span>
      )}
    </form>
  );
}
