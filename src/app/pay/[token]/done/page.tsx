import { formatCents } from "@/lib/money";
import { publicInvoiceStatus } from "@/server/services/stripe-payments";

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
  const inv = await publicInvoiceStatus(token);
  if (!inv) return <Shell title="Not found" body="This payment link is not valid." />;
  const paid = inv.status === "PAID";
  if (result === "success") {
    return (
      <Shell
        title={paid ? "Payment received" : "Thank you"}
        body={
          paid
            ? `Invoice ${inv.number} is paid in full. A receipt is on its way from Stripe.`
            : `We are confirming your payment for invoice ${inv.number}. This usually takes a few seconds; bank payments can take a few days.`
        }
      />
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
