import { Badge } from "@/components/ui/badge";

const STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft", "bg-slate-200 text-slate-800 hover:bg-slate-200"],
  SENT: ["Sent", "bg-blue-100 text-blue-900 hover:bg-blue-100"],
  ACCEPTED: ["Accepted", "bg-emerald-100 text-emerald-900 hover:bg-emerald-100"],
  DECLINED: ["Declined", "bg-red-100 text-red-900 hover:bg-red-100"],
  EXPIRED: ["Expired", "bg-amber-100 text-amber-900 hover:bg-amber-100"],
  PARTIALLY_PAID: ["Partially paid", "bg-amber-100 text-amber-900 hover:bg-amber-100"],
  PAID: ["Paid", "bg-emerald-100 text-emerald-900 hover:bg-emerald-100"],
  VOID: ["Void", "bg-slate-200 text-slate-600 hover:bg-slate-200"],
  OVERDUE: ["Overdue", "bg-red-100 text-red-900 hover:bg-red-100"],
};

export function BillingStatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, ""];
  return (
    <Badge variant="secondary" className={cls}>
      {label}
    </Badge>
  );
}
