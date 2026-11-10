"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** "Send revised quote" with an optional note the client sees in the portal and the email. Two steps, no browser dialogs. */
export function ReviseForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>Send revised quote</Button>
    );
  return (
    <form action={action} className="w-full max-w-xl space-y-2 rounded-xl border p-3">
      <Label htmlFor="revise-note">Note to the client (optional)</Label>
      <Textarea id="revise-note" name="note" rows={3} maxLength={2000} placeholder="e.g. Removed the extra page and lowered the total." />
      <p className="text-muted-foreground text-xs">Emails the updated PDF and puts the quote back in front of the client to accept or decline.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Send revised quote
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
