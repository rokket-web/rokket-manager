import { formatCents } from "@/lib/money";
import { AutoRefresh } from "@/components/billing/auto-refresh";
import { publicInvoiceStatus, refreshPublicInvoice } from "@/server/services/stripe-payments";

export const metadata = { title: "Payment", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PayDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await params;
  const { result } = await searchParams;
  await refreshPublicInvoice(token); // confirm with Stripe so a fast payment shows as paid right away
  const inv = await publicInvoiceStatus(token);
  if (!inv) return <Shell title="Not found" body="This payment link is not valid." />;
  const paid = inv.status === "PAID";
  if (result === "success") {
    return (
      <>
        <AutoRefresh active={!paid} />
        <Shell
          title={paid ? "Payment received" : "Payment pending"}
          body={
            paid
              ? `Invoice ${inv.number} is paid in full. A receipt is on its way from Stripe.`
              : inv.processing
                ? `Your payment for invoice ${inv.number} is being processed. Bank payments can take a few days. You don't need to do anything else.`
                : `We are confirming your payment for invoice ${inv.number}. This page updates on its own and usually takes a few seconds.`
          }
        />
      </>
    );
  }
  return (
    <Shell
      title="Payment not completed"
      body={`No payment was made on invoice ${inv.number}. ${paid ? "This invoice is already paid." : `Balance due: ${formatCents(Math.max(0, inv.totalCents - inv.paidCents), inv.currency)}.`}`}
      retry={!paid ? `/pay/${token}` : undefined}
    />
  );
}

function Shell({ title, body, retry }: { title: string; body: string; retry?: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground text-sm">{body}</p>
      {retry && (
        <a href={retry} className="text-sm underline">
          Try again
        </a>
      )}
    </main>
  );
}
