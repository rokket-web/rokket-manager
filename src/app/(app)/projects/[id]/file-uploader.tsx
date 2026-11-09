"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmUploadAction, requestUploadAction } from "../actions";

/** Uploads straight to storage with a short-lived signed URL; only metadata passes through our server. */
export function FileUploader({
  clientId,
  projectId,
  revalidate,
}: {
  clientId: string;
  projectId?: string;
  revalidate: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    setStatus("Preparing upload...");
    try {
      const req = await requestUploadAction({
        clientId,
        projectId,
        filename: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
      });
      if ("error" in req) throw new Error(req.error);
      setStatus("Uploading...");
      const put = await fetch(req.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": req.contentType },
        body: file,
      });
      if (!put.ok) throw new Error("Upload to storage failed.");
      const done = await confirmUploadAction(req.fileId, revalidate);
      if (!done.ok) throw new Error(done.error ?? "Could not confirm the upload.");
      if (input.current) input.current.value = "";
      setStatus("Uploaded.");
      router.refresh();
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="upload-file">Upload a file (max 100 MB)</Label>
        <Input id="upload-file" ref={input} type="file" required />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Working..." : "Upload"}
      </Button>
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
