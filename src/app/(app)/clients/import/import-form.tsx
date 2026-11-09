"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importCsvAction, type ImportState } from "../actions";

export function ImportForm() {
  const [state, action, pending] = useActionState(importCsvAction, {} as ImportState);
  return (
    <div className="max-w-xl space-y-4">
      <form action={action} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="file">CSV file</Label>
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Importing..." : "Import"}
        </Button>
      </form>
      {"error" in state && state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      {state.done && (
        <div role="status" className="space-y-2 rounded-md border p-3 text-sm">
          {state.fatal ? (
            <p className="text-destructive">{state.fatal}</p>
          ) : (
            <p>
              <strong>{state.created}</strong> created, <strong>{state.skipped}</strong> skipped (already exist),{" "}
              <strong>{state.errors.length}</strong> with errors.
            </p>
          )}
          {state.errors.length > 0 && (
            <ul className="list-disc pl-5">
              {state.errors.slice(0, 50).map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
