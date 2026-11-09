"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Two-step confirm without browser dialogs. */
export function DeleteClientButton({ action, name }: { action: () => Promise<void>; name: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <Button variant="outline" onClick={() => setArmed(true)}>
        Delete
      </Button>
    );
  return (
    <form action={action} className="flex items-center gap-2">
      <span className="text-sm">Delete {name} and all its contacts and notes?</span>
      <Button type="submit" variant="destructive" size="sm">
        Yes, delete
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </form>
  );
}
