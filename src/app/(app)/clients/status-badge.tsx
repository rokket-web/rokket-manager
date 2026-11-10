import { Badge } from "@/components/ui/badge";

const LABEL = { LEAD: "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300", ACTIVE: "Active", PAST: "Past" } as const;
const STYLE = {
  LEAD: "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300",
  ACTIVE: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300",
  PAST: "bg-slate-100 text-slate-500 hover:bg-slate-100 dark:bg-white/10 dark:text-slate-300",
} as const;

export function StatusBadge({ status }: { status: keyof typeof LABEL }) {
  return (
    <Badge variant="secondary" className={STYLE[status]}>
      {LABEL[status]}
    </Badge>
  );
}
