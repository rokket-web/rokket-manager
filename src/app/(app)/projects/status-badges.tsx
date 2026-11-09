import { Badge } from "@/components/ui/badge";

const PROJECT: Record<string, [string, string]> = {
  PLANNING: ["Planning", "bg-slate-200 text-slate-800 hover:bg-slate-200"],
  ACTIVE: ["Active", "bg-emerald-100 text-emerald-900 hover:bg-emerald-100"],
  ON_HOLD: ["On hold", "bg-amber-100 text-amber-900 hover:bg-amber-100"],
  COMPLETED: ["Completed", "bg-blue-100 text-blue-900 hover:bg-blue-100"],
  CANCELLED: ["Cancelled", "bg-red-100 text-red-900 hover:bg-red-100"],
};
const PRIORITY: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700 hover:bg-slate-100",
  MEDIUM: "bg-blue-100 text-blue-900 hover:bg-blue-100",
  HIGH: "bg-orange-100 text-orange-900 hover:bg-orange-100",
  URGENT: "bg-red-100 text-red-900 hover:bg-red-100",
};

export function ProjectStatusBadge({ status }: { status: string }) {
  const [label, cls] = PROJECT[status] ?? [status, ""];
  return (
    <Badge variant="secondary" className={cls}>
      {label}
    </Badge>
  );
}
export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge variant="secondary" className={PRIORITY[priority]}>
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </Badge>
  );
}
export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" }) : "-";
