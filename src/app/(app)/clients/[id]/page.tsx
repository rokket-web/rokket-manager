import Link from "next/link";
import { buttonVariants, Button } from "@/components/ui/button";
import { requireActor } from "@/server/authz/session";
import { can } from "@/server/authz/clients";
import { getClient } from "@/server/services/clients";
import { formatTax } from "@/lib/tax";
import { StatusBadge } from "../status-badge";
import {
  addContactAction,
  addNoteAction,
  deleteClientAction,
  deleteContactAction,
  deleteNoteAction,
  setStatusAction,
  updateContactAction,
} from "../actions";
import { ContactForm, NoteForm } from "./contact-forms";
import { DeleteClientButton } from "./delete-client-button";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: "Client" };
}

const TABS = [
  ["overview", "Overview"],
  ["contacts", "Contacts"],
  ["notes", "Notes"],
  ["timeline", "Timeline"],
  ["files", "Files"],
  ["projects", "Projects"],
  ["invoices", "Invoices"],
] as const;

const fmt = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "overview";
  const c = await getClient(actor, id);
  const canWrite = can(actor.role, "client:write");
  const address = [
    c.addressLine1,
    c.addressLine2,
    [c.city, c.state, c.postalCode].filter(Boolean).join(", "),
    c.country,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <StatusBadge status={c.status} />
        {c.tagNames.map((t) => (
          <span key={t} className="bg-muted rounded px-1.5 py-0.5 text-xs">
            {t}
          </span>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <form action={setStatusAction.bind(null, id)} className="flex items-center gap-1">
                <select
                  name="status"
                  aria-label="Change status"
                  defaultValue={c.status}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  <option value="LEAD">Lead</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PAST">Past</option>
                </select>
                <Button type="submit" variant="secondary" size="sm">
                  Update
                </Button>
              </form>
              <Link href={`/clients/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
                Edit
              </Link>
              <DeleteClientButton action={deleteClientAction.bind(null, id)} name={c.name} />
            </>
          )}
        </div>
      </div>

      <nav aria-label="Client sections" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`/clients/${id}?tab=${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={`px-3 py-2 text-sm whitespace-nowrap ${tab === k ? "border-primary border-b-2 font-medium" : "text-muted-foreground"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <dl className="grid max-w-3xl gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {[
            ["Email", c.email],
            ["Phone", c.phone],
            ["Website", c.website],
            ["Industry", c.industry],
            ["Billing email", c.billingEmail],
            ["Tax rate", formatTax(c.taxRateBps)],
            ["Created", fmt(c.createdAt)],
          ].map(([k, v]) => (
            <div key={k as string}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v || "-"}</dd>
            </div>
          ))}
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Address</dt>
            <dd>{address.length ? address.map((l) => <div key={l}>{l}</div>) : "-"}</dd>
          </div>
        </dl>
      )}

      {tab === "contacts" && (
        <div className="space-y-4">
          {c.contacts.length === 0 && <p className="text-muted-foreground text-sm">No contacts yet.</p>}
          {c.contacts.map((p) => (
            <div key={p.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {p.firstName} {p.lastName}
                </span>
                {p.isPrimary && <span className="bg-muted rounded px-1.5 py-0.5 text-xs">Primary</span>}
                <span className="text-muted-foreground text-sm">
                  {[p.title, p.email, p.phone].filter(Boolean).join(" · ")}
                </span>
                {canWrite && (
                  <form action={deleteContactAction.bind(null, id, p.id)} className="ml-auto">
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                )}
              </div>
              {canWrite && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <div className="mt-2">
                    <ContactForm
                      action={updateContactAction.bind(null, id, p.id)}
                      defaults={{
                        firstName: p.firstName,
                        lastName: p.lastName,
                        email: p.email ?? "",
                        phone: p.phone ?? "",
                        title: p.title ?? "",
                        isPrimary: p.isPrimary,
                      }}
                      submitLabel="Save contact"
                    />
                  </div>
                </details>
              )}
            </div>
          ))}
          {canWrite && (
            <section className="rounded-md border p-3">
              <h2 className="mb-2 font-medium">Add contact</h2>
              <ContactForm action={addContactAction.bind(null, id)} submitLabel="Add contact" resetOnSuccess />
            </section>
          )}
        </div>
      )}

      {tab === "notes" && (
        <div className="max-w-2xl space-y-4">
          <p className="text-muted-foreground text-xs">Internal only. Notes are never shown in the client portal.</p>
          {canWrite && <NoteForm action={addNoteAction.bind(null, id)} />}
          {c.notes.length === 0 && <p className="text-muted-foreground text-sm">No notes yet.</p>}
          {c.notes.map((n) => (
            <article key={n.id} className="rounded-md border p-3">
              <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              <div className="text-muted-foreground mt-2 flex items-center text-xs">
                <span>
                  {n.authorId ? (c.actorNames[n.authorId] ?? "Unknown") : "System"} · {fmt(n.createdAt)}
                </span>
                {canWrite && (
                  <form action={deleteNoteAction.bind(null, id, n.id)} className="ml-auto">
                    <Button type="submit" variant="ghost" size="sm">
                      Delete
                    </Button>
                  </form>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === "timeline" && (
        <ol className="max-w-2xl space-y-3 text-sm">
          {c.activities.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
          {c.activities.map((a) => (
            <li key={a.id} className="border-l-2 pl-3">
              <div>{a.summary}</div>
              <div className="text-muted-foreground text-xs">
                {a.actorId ? (c.actorNames[a.actorId] ?? "Unknown") : "System"} · {fmt(a.createdAt)}
              </div>
            </li>
          ))}
        </ol>
      )}

      {["files", "projects", "invoices"].includes(tab) && (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">
          {tab === "files" && "File storage arrives in Phase 3."}
          {tab === "projects" && "Projects arrive in Phase 3."}
          {tab === "invoices" && "Invoices arrive in Phase 4."}
        </p>
      )}
    </div>
  );
}
