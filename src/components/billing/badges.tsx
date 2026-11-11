import { Badge } from "@/components/ui/badge";

const STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft", "bg-slate-100 text-slate-500 hover:bg-slate-100 dark:bg-white/10 dark:text-slate-300"],
  SENT: ["Sent", "bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/20 dark:text-violet-300"],
  ACCEPTED: ["Accepted", "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300"],
  DECLINED: ["Declined", "bg-rose-100 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/20 dark:text-rose-300"],
  CHANGES_REQUESTED: ["Edits requested", "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300"],
  EXPIRED: ["Expired", "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300"],
  PARTIALLY_PAID: ["Partially paid", "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300"],
  PAID: ["Paid", "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300"],
  VOID: ["Void", "bg-slate-100 text-slate-500 hover:bg-slate-100 dark:bg-white/10 dark:text-slate-300"],
  PROCESSING: ["Payment pending", "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300"],
  OVERDUE: ["Overdue", "bg-rose-100 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/20 dark:text-rose-300"],
};

export function BillingStatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, ""];
  return (
    <Badge variant="secondary" className={cls}>
      {label}
    </Badge>
  );
}
