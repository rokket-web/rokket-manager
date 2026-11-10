"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Two-step confirm without browser dialogs. */
export function ConfirmButton({
  action,
  label,
  prompt,
  confirmLabel = "Yes",
  destructive,
}: {
  action: () => Promise<void>;
  label: string;
  prompt: string;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <Button variant="outline" onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{prompt}</span>
      <Button type="submit" variant={destructive ? "destructive" : "default"} size="sm">
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </form>
  );
}
