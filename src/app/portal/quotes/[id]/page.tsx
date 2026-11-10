import { orNotFound } from "@/lib/not-found";
import { BillingStatusBadge } from "@/components/billing/badges";
import { LinesTable } from "@/components/billing/doc-view";
import { buttonVariants } from "@/components/ui/button";
import { fmtDateUtc } from "@/lib/format";
import { requireActor } from "@/server/authz/session";
import { getPortalQuote } from "@/server/services/portal";
import { QuoteHistory } from "@/components/quotes/history";
import { acceptQuoteAction, declineQuoteAction, requestQuoteEditsAction } from "../../actions";
import { QuoteResponseForm } from "./response-form";

export const metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

export default async function PortalQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(["CLIENT"]);
  const q = await orNotFound(getPortalQuote(actor, id));
  const open = q.status === "SENT" && !q.expired;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            Quote {q.number}
            {q.title ? `: ${q.title}` : ""}
          </h1>
          <BillingStatusBadge status={q.expired ? "EXPIRED" : q.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          Valid until {fmtDateUtc(q.validUntil)}
          {q.respondedAt && ` · Answered ${fmtDateUtc(q.respondedAt)}`}
        </p>
      </div>

      {sp.notice && (
        <p role="status" className="text-sm">
          {sp.notice}
        </p>
      )}
      {sp.error && (
        <p role="alert" className="text-destructive text-sm">
          {sp.error}
        </p>
      )}
      {q.expired && <p className="text-muted-foreground text-sm">This quote has expired. Please contact us for an updated one.</p>}

      {q.status === "CHANGES_REQUESTED" && (
        <p role="status" className="bg-tint-amber max-w-2xl rounded-xl p-3 text-sm">
          You asked for changes{q.respondedAt ? ` on ${fmtDateUtc(q.respondedAt)}` : ""}. We&apos;ll send you a revised quote
          to review.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a href={`/api/portal/quotes/${id}/pdf`} className={buttonVariants({ variant: "outline" })}>
          Download PDF
        </a>
      </div>

      {open && (
        <QuoteResponseForm
          accept={acceptQuoteAction.bind(null, id)}
          decline={declineQuoteAction.bind(null, id)}
          requestEdits={requestQuoteEditsAction.bind(null, id)}
        />
      )}

      <LinesTable
        lines={q.lines}
        currency={q.currency}
        subtotalCents={q.subtotalCents}
        taxCents={q.taxCents}
        totalCents={q.totalCents}
        taxRateBps={q.taxRateBps}
      />

      {(q.notes || q.terms) && (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          {q.notes && (
            <div>
              <h2 className="mb-1 font-medium">Notes</h2>
              <p className="whitespace-pre-wrap">{q.notes}</p>
            </div>
          )}
          {q.terms && (
            <div>
              <h2 className="mb-1 font-medium">Terms</h2>
              <p className="whitespace-pre-wrap">{q.terms}</p>
            </div>
          )}
        </div>
      )}

      <QuoteHistory items={q.history} viewer="client" />
    </div>
  );
}
