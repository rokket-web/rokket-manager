"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Act = (fd: FormData) => Promise<void>;

/**
 * Accept / Request edits / Decline, with a notes box. Accept and Decline ask for a second click (no browser dialogs);
 * Request edits needs a note saying what to change (the server enforces this too).
 */
export function QuoteResponseForm({ accept, decline, requestEdits }: { accept: Act; decline: Act; requestEdits: Act }) {
  const [confirm, setConfirm] = useState<null | "accept" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const note = useRef<HTMLTextAreaElement>(null);

  return (
    <form className="max-w-2xl space-y-3 rounded-xl border p-4">
      <div className="space-y-1">
        <Label htmlFor="quote-note">Notes</Label>
        <Textarea
          id="quote-note"
          ref={note}
          name="note"
          rows={4}
          maxLength={2000}
          placeholder="Optional. If you would like changes, tell us what to adjust."
          onChange={() => setError(null)}
        />
        <p className="text-muted-foreground text-xs">Required if you request edits. We&apos;ll see your note with your answer.</p>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>

      {confirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{confirm === "accept" ? "Accept this quote as written?" : "Decline this quote?"}</span>
          <Button type="submit" size="sm" variant={confirm === "decline" ? "destructive" : "default"} formAction={confirm === "accept" ? accept : decline}>
            {confirm === "accept" ? "Yes, accept" : "Yes, decline"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setConfirm("accept")}>
            Accept quote
          </Button>
          <Button
            type="submit"
            variant="outline"
            formAction={requestEdits}
            onClick={(e) => {
              if (!note.current?.value.trim()) {
                e.preventDefault();
                setError("Please tell us what you would like changed.");
                note.current?.focus();
              }
            }}
          >
            Request edits
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirm("decline")}>
            Decline
          </Button>
        </div>
      )}
    </form>
  );
}
