import Link from "next/link";
import { EmailStatusBadge, EMAIL_STATUS_HELP } from "@/components/email/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { EMAIL_KINDS, emailKindLabel } from "@/lib/email-events";
import { requireActor } from "@/server/authz/session";
import { countRecentEmailProblems, listEmailLog } from "@/server/services/email-log";

export const metadata = { title: "Email log" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; client?: string; page?: string }>;
}) {
  const actor = await requireActor(["ADMIN"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [log, problems] = await Promise.all([
    listEmailLog(actor, { status: sp.status, kind: sp.kind, clientId: sp.client, page }),
    countRecentEmailProblems(actor),
  ]);
  const pages = Math.max(1, Math.ceil(log.total / log.pageSize));
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status: sp.status, kind: sp.kind, client: sp.client, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return p.size ? `?${p}` : "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Email log</h1>
        <Link href="/settings" className={`${buttonVariants({ variant: "outline", size: "sm" })} ml-auto`}>
          Back to settings
        </Link>
      </div>
      <p className="text-muted-foreground max-w-2xl text-sm">
        Every email the app sends: invoices, quotes, messages, sign-in links and emails you write to clients. Message text is never stored here.
        &quot;Delivered&quot;, &quot;Bounced&quot; and &quot;Spam complaint&quot; come from Mailgun and need its webhook (see docs/mailgun-webhooks.md).
      </p>
      {problems > 0 && (
        <p role="status" className="max-w-2xl rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {problems} email{problems === 1 ? "" : "s"} failed, bounced or got a spam complaint in the last 30 days.{" "}
          <Link href="/settings/email-log?status=BOUNCED" className="underline">Bounced</Link> ·{" "}
          <Link href="/settings/email-log?status=FAILED" className="underline">Failed</Link> ·{" "}
          <Link href="/settings/email-log?status=COMPLAINED" className="underline">Complaints</Link>
        </p>
      )}

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground block">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="border-input bg-background h-9 rounded-md border px-2 text-sm">
            <option value="">All</option>
            {Object.keys(EMAIL_STATUS_HELP).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground block">Type</span>
          <select name="kind" defaultValue={sp.kind ?? ""} className="border-input bg-background h-9 rounded-md border px-2 text-sm">
            <option value="">All</option>
            {Object.entries(EMAIL_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {sp.client && <input type="hidden" name="client" value={sp.client} />}
        <button type="submit" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Filter
        </button>
        {(sp.status || sp.kind || sp.client) && (
          <Link href="/settings/email-log" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Clear
          </Link>
        )}
      </form>

      {log.rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-6 text-sm">No emails match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Type</th>
                <th className="p-2">To</th>
                <th className="p-2">Subject</th>
                <th className="p-2">Client</th>
                <th className="p-2">Sent by</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {log.rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{fmt(r.createdAt)}</td>
                  <td className="p-2">{emailKindLabel(r.kind)}</td>
                  <td className="p-2 break-all">{r.toEmail}</td>
                  <td className="p-2">{r.subject}</td>
                  <td className="p-2">
                    {r.client ? (
                      <Link href={`/clients/${r.client.id}?tab=email`} className="hover:underline">
                        {r.client.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="p-2">{r.sentBy}</td>
                  <td className="p-2">
                    <EmailStatusBadge status={r.status} />
                    {r.detail && <p className="text-muted-foreground mt-1 max-w-xs text-xs">{r.detail}</p>}
                    {r.status !== "SENT" && r.updatedAt > r.createdAt && (
                      <p className="text-muted-foreground mt-1 text-xs">{fmt(r.updatedAt)}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        <span>
          {log.total} email{log.total === 1 ? "" : "s"} · page {page} of {pages}
        </span>
        {page > 1 && (
          <Link href={`/settings/email-log${qs({ page: String(page - 1) })}`} className="hover:underline">
            Newer
          </Link>
        )}
        {page < pages && (
          <Link href={`/settings/email-log${qs({ page: String(page + 1) })}`} className="hover:underline">
            Older
          </Link>
        )}
      </div>
    </div>
  );
}
