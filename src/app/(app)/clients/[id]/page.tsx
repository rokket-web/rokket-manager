import { orNotFound } from "@/lib/not-found";
import Link from "next/link";
import { buttonVariants, Button } from "@/components/ui/button";
import { requireActor } from "@/server/authz/session";
import { can } from "@/server/authz/clients";
import { getClient } from "@/server/services/clients";
import { listProjectsForClient } from "@/server/services/projects";
import { listFiles } from "@/server/services/files";
import { canProject } from "@/server/authz/projects";
import { formatCents } from "@/lib/money";
import { ProjectStatusBadge, fmtDate } from "../../projects/status-badges";
import { FileUploader } from "../../projects/[id]/file-uploader";
import { deleteFileAction } from "../../projects/actions";
import { DeleteButton } from "../../projects/[id]/delete-button";
import { formatTax } from "@/lib/tax";
import { StatusBadge } from "../status-badge";
import { BillingStatusBadge } from "@/components/billing/badges";
import { ConfirmButton } from "@/components/billing/confirm-button";
import { FieldForm } from "@/components/forms/field-form";
import { listInvoices } from "@/server/services/invoices";
import { listQuotes } from "@/server/services/quotes";
import { getPortalAccess } from "@/server/services/portal-access";
import { getAdminThread, markThreadReadByAdmin, unreadFromClientCount } from "@/server/services/messages";
import { getClientEmailRecipient } from "@/server/services/client-email";
import { Thread } from "@/components/messages/thread";
import {
  addContactAction,
  addNoteAction,
  deleteClientAction,
  deleteContactAction,
  deleteNoteAction,
  invitePortalUserAction,
  resendPortalInviteAction,
  setPortalActiveAction,
  sendEmailAction,
  sendMessageAction,
  setStatusAction,
  updateContactAction,
} from "../actions";
import { ContactForm, NoteForm } from "./contact-forms";
import { EmailForm, MessageForm } from "./message-forms";
import { DeleteClientButton } from "./delete-client-button";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: "Client" };
}

const TABS = [
  ["overview", "Overview"],
  ["contacts", "Contacts"],
  ["notes", "Notes"],
  ["messages", "Messages"],
  ["email", "Email"],
  ["timeline", "Timeline"],
  ["files", "Files"],
  ["projects", "Projects"],
  ["invoices", "Invoices"],
  ["portal", "Portal access"],
] as const;

const fmt = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; error?: string; notice?: string }>;
}) {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const { id } = await params;
  const sp = await searchParams;
  const canWriteEarly = can(actor.role, "client:write");
  const visibleTabs = TABS.filter(([k]) => (k !== "portal" && k !== "messages" && k !== "email") || canWriteEarly);
  const tab = visibleTabs.find(([k]) => k === sp.tab)?.[0] ?? "overview";
  const c = await orNotFound(getClient(actor, id));
  const unread = canWriteEarly ? await unreadFromClientCount(actor, id) : 0;
  const errorKey = sp.error;
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
              <Link href={`/quotes/new?clientId=${id}`} className={buttonVariants({ variant: "outline" })}>
                New quote
              </Link>
              <Link href={`/invoices/new?clientId=${id}`} className={buttonVariants({ variant: "outline" })}>
                New invoice
              </Link>
              <Link href={`/clients/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
                Edit
              </Link>
              <DeleteClientButton action={deleteClientAction.bind(null, id)} name={c.name} />
            </>
          )}
        </div>
      </div>

      {errorKey === "has-projects" && (
        <p role="alert" className="text-destructive text-sm">
          This client has projects. Delete or finish those first.
        </p>
      )}
      <nav aria-label="Client sections" className="flex gap-1 overflow-x-auto border-b">
        {visibleTabs.map(([k, label]) => (
          <Link
            key={k}
            href={`/clients/${id}?tab=${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={`px-3 py-2 text-sm whitespace-nowrap ${tab === k ? "border-primary border-b-2 font-medium" : "text-muted-foreground"}`}
          >
            {label}
            {k === "messages" && unread > 0 && tab !== "messages" && (
              <span className="bg-primary text-primary-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-xs" aria-label={`${unread} unread`}>
                {unread}
              </span>
            )}
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

      {tab === "messages" && canWrite && <MessagesTab actor={actor} clientId={id} />}

      {tab === "email" && canWrite && <EmailTab actor={actor} clientId={id} />}

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

      {tab === "projects" && <ClientProjects actor={actor} clientId={id} />}
      {tab === "files" && <ClientFiles actor={actor} clientId={id} canWrite={canWrite} />}
      {tab === "invoices" && <ClientBilling actor={actor} clientId={id} />}
      {tab === "portal" && canWrite && (
        <PortalTab
          clientId={id}
          notice={sp.notice}
          error={sp.error}
          defaults={{
            name: c.contacts.find((x) => x.isPrimary)?.firstName
              ? `${c.contacts.find((x) => x.isPrimary)!.firstName} ${c.contacts.find((x) => x.isPrimary)!.lastName}`.trim()
              : "",
            email: c.billingEmail ?? c.email ?? c.contacts.find((x) => x.isPrimary)?.email ?? "",
          }}
          actor={actor}
        />
      )}
    </div>
  );
}

async function ClientBilling({ actor, clientId }: { actor: Awaited<ReturnType<typeof requireActor>>; clientId: string }) {
  if (actor.role !== "ADMIN") {
    return <p className="text-muted-foreground rounded-md border p-6 text-sm">Billing is visible to admins only.</p>;
  }
  const [inv, quo] = await Promise.all([
    listInvoices(actor, { clientId, pageSize: 50 }),
    listQuotes(actor, { clientId, pageSize: 50 }),
  ]);
  const row = (href: string, label: string, status: string, total: number, currency: string) => (
    <tr key={href} className="border-t">
      <td className="p-2">
        <Link href={href} className="font-medium hover:underline">
          {label}
        </Link>
      </td>
      <td className="p-2">
        <BillingStatusBadge status={status} />
      </td>
      <td className="p-2 text-right tabular-nums">{formatCents(total, currency)}</td>
    </tr>
  );
  return (
    <div className="space-y-6">
      {[
        ["Invoices", inv.items.map((i) => row(`/invoices/${i.id}`, i.number ?? "Draft invoice", i.status, i.totalCents, i.currency))],
        ["Quotes", quo.items.map((q) => row(`/quotes/${q.id}`, q.number ?? "Draft quote", q.status, q.totalCents, q.currency))],
      ].map(([title, rows]) => (
        <section key={title as string} className="space-y-2">
          <h2 className="font-medium">{title as string}</h2>
          {(rows as unknown[]).length === 0 ? (
            <p className="text-muted-foreground text-sm">None yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <tbody>{rows as React.ReactNode}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      <Link href={`/invoices/new?clientId=${clientId}`} className="text-sm underline">
        New invoice for this client
      </Link>
    </div>
  );
}

async function PortalTab({
  clientId,
  notice,
  error,
  defaults,
  actor,
}: {
  clientId: string;
  notice?: string;
  error?: string;
  defaults: { name: string; email: string };
  actor: Awaited<ReturnType<typeof requireActor>>;
}) {
  const access = await getPortalAccess(actor, clientId);
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-muted-foreground text-sm">
        A portal user lets this client sign in with an emailed link to see their quotes, invoices and shared project
        updates. Each client has one portal user.
      </p>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {!access ? (
        <FieldForm
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "email", label: "Email", type: "email", required: true, hint: "The invite link is sent here." },
          ]}
          action={invitePortalUserAction.bind(null, clientId)}
          defaults={defaults}
          submitLabel="Send invite"
        />
      ) : (
        <div className="space-y-3 rounded-md border p-4 text-sm">
          <p>
            <span className="font-medium">{access.name}</span> · {access.email}
          </p>
          <p className="text-muted-foreground">
            {access.active ? "Access is on." : "Access is turned off."} {access._count.sessions} active session
            {access._count.sessions === 1 ? "" : "s"}.
          </p>
          <div className="flex flex-wrap gap-2">
            {access.active ? (
              <>
                <ConfirmButton
                  action={resendPortalInviteAction.bind(null, clientId)}
                  label="Resend invite"
                  prompt={`Email a new sign-in link to ${access.email}?`}
                  confirmLabel="Yes, send"
                />
                <ConfirmButton
                  action={setPortalActiveAction.bind(null, clientId, false)}
                  label="Turn off access"
                  prompt="Sign them out and block portal access?"
                  confirmLabel="Yes, turn off"
                  destructive
                />
              </>
            ) : (
              <ConfirmButton
                action={setPortalActiveAction.bind(null, clientId, true)}
                label="Restore access"
                prompt="Allow this person to sign in again?"
                confirmLabel="Yes, restore"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function ClientProjects({
  actor,
  clientId,
}: {
  actor: Awaited<ReturnType<typeof requireActor>>;
  clientId: string;
}) {
  const projects = await listProjectsForClient(actor, clientId);
  return (
    <div className="space-y-3">
      {canProject(actor.role, "project:write") && (
        <Link href={`/projects/new?clientId=${clientId}`} className={buttonVariants({ variant: "outline" })}>
          New project
        </Link>
      )}
      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">No projects yet.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 p-2">
              <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                {p.name}
              </Link>
              <ProjectStatusBadge status={p.status} />
              <span className="text-muted-foreground">due {fmtDate(p.dueDate)}</span>
              {p.budgetCents != null && (
                <span className="text-muted-foreground ml-auto">{formatCents(p.budgetCents, p.currency)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function ClientFiles({
  actor,
  clientId,
  canWrite,
}: {
  actor: Awaited<ReturnType<typeof requireActor>>;
  clientId: string;
  canWrite: boolean;
}) {
  const files = await listFiles(actor, { clientId });
  const path = `/clients/${clientId}`;
  return (
    <div className="max-w-3xl space-y-4">
      {canWrite && <FileUploader clientId={clientId} revalidate={path} />}
      {files.length === 0 ? (
        <p className="text-muted-foreground text-sm">No files yet.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 p-2">
              <a href={`/api/files/${f.id}`} className="font-medium hover:underline">
                {f.name}
              </a>
              <span className="text-muted-foreground">
                {f.projectId ? "project file" : "client file"} · {(f.size / 1024 / 1024).toFixed(2)} MB
              </span>
              {canWrite && (
                <div className="ml-auto">
                  <DeleteButton action={deleteFileAction.bind(null, f.id, path)} label={`Delete ${f.name}?`} small />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function MessagesTab({ actor, clientId }: { actor: Awaited<ReturnType<typeof requireActor>>; clientId: string }) {
  const { messages, names, hasPortalAccess } = await getAdminThread(actor, clientId);
  await markThreadReadByAdmin(actor, clientId);
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-muted-foreground text-xs">
        Visible to the client in their portal. They get an email notification (without the message text).
      </p>
      {!hasPortalAccess && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          This client has no active portal access, so they cannot see messages. Invite them from the Portal access tab, or use Email.
        </p>
      )}
      <Thread
        mine="admin"
        messages={messages.map((m) => ({
          id: m.id,
          fromClient: m.fromClient,
          body: m.body,
          createdAt: m.createdAt,
          senderName: m.authorId ? (names[m.authorId] ?? "Unknown") : "System",
        }))}
      />
      <MessageForm action={sendMessageAction.bind(null, clientId)} />
    </div>
  );
}

async function EmailTab({ actor, clientId }: { actor: Awaited<ReturnType<typeof requireActor>>; clientId: string }) {
  const to = await getClientEmailRecipient(actor, clientId);
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-muted-foreground text-xs">
        Sends a regular email from the company address. A copy is recorded on the timeline. Replies go to the company email.
      </p>
      {to ? (
        <EmailForm action={sendEmailAction.bind(null, clientId)} to={to} />
      ) : (
        <p role="alert" className="text-sm">
          This client has no email address yet. Add one on the client or a contact first.
        </p>
      )}
    </div>
  );
}
