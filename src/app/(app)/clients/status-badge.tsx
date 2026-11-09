import { Badge } from "@/components/ui/badge";

const LABEL = { LEAD: "Lead", ACTIVE: "Active", PAST: "Past" } as const;
const STYLE = {
  LEAD: "bg-amber-100 text-amber-900 hover:bg-amber-100",
  ACTIVE: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
  PAST: "bg-slate-200 text-slate-800 hover:bg-slate-200",
} as const;

export function StatusBadge({ status }: { status: keyof typeof LABEL }) {
  return (
    <Badge variant="secondary" className={STYLE[status]}>
      {LABEL[status]}
    </Badge>
  );
}
