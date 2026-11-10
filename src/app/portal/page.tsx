import Link from "next/link";
import { formatCents } from "@/lib/money";
import { requireActor } from "@/server/authz/session";
import { getPortalSummary } from "@/server/services/portal";

export const metadata = { title: "Client Portal" };
export const dynamic = "force-dynamic";

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ invited?: string }> }) {
  const actor = await requireActor(["CLIENT"]);
  const { invited } = await searchParams;
  const s = await getPortalSummary(actor);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {invited ? "Welcome" : "Hello"}, {actor.name}
        </h1>
        {invited && (
          <p className="text-muted-foreground text-sm">
            You&apos;re signed in. Next time, request a sign-in link from the login page using this email address.
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card href="/portal/invoices" label="Balance due" value={formatCents(s.outstandingCents)}>
          {s.openInvoices} open invoice{s.openInvoices === 1 ? "" : "s"}
          {s.overdueInvoices > 0 && <span className="text-destructive"> · {s.overdueInvoices} overdue</span>}
        </Card>
        <Card href="/portal/projects" label="Projects" value={String(s.sharedProjects)}>
          {s.sharedProjects === 0 ? "None shared yet" : "In progress"}
        </Card>
        <Card href="/portal/quotes" label="Quotes to review" value={String(s.quotesAwaiting)}>
          {s.quotesAwaiting === 0 ? "Nothing waiting" : "Waiting for your answer"}
        </Card>
      </div>
    </div>
  );
}

function Card({ href, label, value, children }: { href: string; label: string; value: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="hover:bg-accent/40 rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{children}</p>
    </Link>
  );
}
