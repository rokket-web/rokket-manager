import Link from "next/link";
import { requireActor } from "@/server/authz/session";
import { CLIENT_CSV_HEADERS } from "@/lib/csv";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import clients" };

export default async function ImportPage() {
  await requireActor(["ADMIN"]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Import clients</h1>
      <div className="text-muted-foreground max-w-xl space-y-1 text-sm">
        <p>
          Upload a CSV with a header row. Only <code>name</code> is required. Max 500 rows / 1 MB.
        </p>
        <p>
          Columns: <code>{CLIENT_CSV_HEADERS.join(", ")}</code>. Status is lead, active or past. Clients whose name
          already exists are skipped.
        </p>
        <p>
          <Link href="/api/clients/export" className="underline">
            Download current clients
          </Link>{" "}
          to see the exact format.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
