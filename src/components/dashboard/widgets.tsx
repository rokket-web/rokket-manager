import Link from "next/link";
import { cn } from "cn";
import { formatCents } from "@/lib/money";
import type { Money } from "@/lib/dashboard";

export type Tint = "amber" | "blue" | "pink" | "green" | "violet";
const TINT: Record<Tint, string> = {
  amber: "bg-tint-amber",
  blue: "bg-tint-blue",
  pink: "bg-tint-pink",
  green: "bg-tint-green",
  violet: "bg-tint-violet",
};

/** Money in one or more currencies ("$1,200.00 · EUR 300.00"); "$0.00" when empty. */
export function moneyText(m: Money[]): string {
  return m.length === 0 ? formatCents(0) : m.map((x) => formatCents(x.cents, x.currency)).join(" · ");
}

export function StatCard({
  label,
  value,
  tint,
  href,
  children,
}: {
  label: string;
  value: string;
  tint: Tint;
  href?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums break-words">{value}</p>
      {children && <p className="text-muted-foreground mt-1 text-xs">{children}</p>}
    </>
  );
  const cls = cn("rounded-xl p-4 shadow-sm", TINT[tint], href && "transition-shadow hover:shadow-md");
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action && (
          <Link href={action.href} className="text-muted-foreground text-xs hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{children}</p>;
}

/** "+12%" / "-5%" versus last month; null when there is nothing to compare against. */
export function trend(current: Money[], previous: Money[]): string | null {
  const cur = current[0];
  const prev = previous.find((p) => p.currency === cur?.currency);
  if (!cur || !prev || prev.cents <= 0) return null;
  const pct = Math.round(((cur.cents - prev.cents) / prev.cents) * 100);
  return `${pct > 0 ? "+" : ""}${pct}% vs last month`;
}
