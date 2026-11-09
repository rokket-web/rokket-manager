"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Two-step confirm without browser dialogs. */
export function DeleteButton({
  action,
  label,
  small,
}: {
  action: () => Promise<void>;
  label: string;
  small?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <Button variant={small ? "ghost" : "outline"} size={small ? "sm" : "default"} onClick={() => setArmed(true)}>
        Delete
      </Button>
    );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{label}</span>
      <Button type="submit" variant="destructive" size="sm">
        Yes, delete
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </form>
  );
}
