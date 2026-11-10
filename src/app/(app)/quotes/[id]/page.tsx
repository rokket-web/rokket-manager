import Link from "next/link";
import { BillingStatusBadge } from "@/components/billing/badges";
import { ConfirmButton } from "@/components/billing/confirm-button";
import { LinesTable } from "@/components/billing/doc-view";
import { buttonVariants } from "@/components/ui/button";
import { requireActor } from "@/server/authz/session";
import { getQuote } from "@/server/services/quotes";
import { fmtDate } from "../../projects/status-badges";
import {
  acceptQuoteAction,
  declineQuoteAction,
  deleteQuoteAction,
  invoiceFromQuoteAction,
  resendQuoteAction,
  sendQuoteAction,
} from "../actions";

export const metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const actor = await requireActor(["ADMIN"]);
  const q = await getQuote(actor, id);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const expired = q.status === "SENT" && !!q.validUntil && q.validUntil < today;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            Quote {q.number ?? "(draft)"}
            {q.title ? `: ${q.title}` : ""}
          </h1>
          <BillingStatusBadge status={expired ? "EXPIRED" : q.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          <Link href={`/clients/${q.client.id}`} className="hover:underline">
            {q.client.name}
          </Link>
          {q.project && (
            <>
              {" · "}
              <Link href={`/projects/${q.project.id}`} className="hover:underline">
                {q.project.name}
              </Link>
            </>
          )}
        </p>
        <p className="text-muted-foreground text-sm">
          Valid until {fmtDate(q.validUntil)}
          {q.respondedAt && ` · Answered ${fmtDate(q.respondedAt)}`}
        </p>
      </div>

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

      <div className="flex flex-wrap items-center gap-2">
        {q.status === "DRAFT" && (
          <>
            <Link href={`/quotes/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
              Edit
            </Link>
            <ConfirmButton
              action={sendQuoteAction.bind(null, id)}
              label="Send quote"
              prompt="Email the PDF to the client and lock this quote?"
              confirmLabel="Yes, send"
            />
            <ConfirmButton
              action={deleteQuoteAction.bind(null, id)}
              label="Delete"
              prompt="Delete this draft?"
              confirmLabel="Yes, delete"
              destructive
            />
          </>
        )}
        {q.number && (
          <a href={`/api/quotes/${id}/pdf`} className={buttonVariants({ variant: "outline" })}>
            Download PDF
          </a>
        )}
        {q.status === "SENT" && (
          <>
            <ConfirmButton
              action={resendQuoteAction.bind(null, id)}
              label="Resend email"
              prompt="Email this quote to the client again?"
              confirmLabel="Yes, resend"
            />
            <ConfirmButton
              action={acceptQuoteAction.bind(null, id)}
              label="Record accepted"
              prompt="Record that the client accepted?"
              confirmLabel="Yes, accepted"
            />
            <ConfirmButton
              action={declineQuoteAction.bind(null, id)}
              label="Record declined"
              prompt="Record that the client declined?"
              confirmLabel="Yes, declined"
              destructive
            />
          </>
        )}
        {q.status === "ACCEPTED" &&
          (q.invoice ? (
            <Link href={`/invoices/${q.invoice.id}`} className={buttonVariants({ variant: "outline" })}>
              View invoice {q.invoice.number ?? "(draft)"}
            </Link>
          ) : (
            <ConfirmButton
              action={invoiceFromQuoteAction.bind(null, id)}
              label="Create invoice"
              prompt="Create a draft invoice from this quote?"
              confirmLabel="Yes, create"
            />
          ))}
      </div>

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
    </div>
  );
}
