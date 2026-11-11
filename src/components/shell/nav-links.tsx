"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Clock,
  FileText,
  Home,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { badgeLabel } from "@/lib/badge";

const ICONS: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Overview: Home,
  Clients: Users,
  Projects: Briefcase,
  Time: Clock,
  Quotes: FileText,
  Invoices: Receipt,
  Messages: MessageSquare,
  Settings: Settings,
  Users: UserCog,
};

const UNREAD_POLL_MS = 10_000;

/**
 * `unread` puts a live count badge on one item (the client's Messages tab). It starts from the server-rendered count and
 * re-checks `endpoint` every few seconds while the tab is visible. Opening that page shows no badge: the thread marks
 * messages read as they appear.
 */
export function NavLinks({
  items,
  unread,
}: {
  items: { label: string; href: string }[];
  unread?: { href: string; count: number; endpoint: string };
}) {
  const pathname = usePathname();
  const [count, setCount] = useState(unread?.count ?? 0);
  // A server refresh (e.g. after sending a message) hands us a fresh count: take it.
  const [seen, setSeen] = useState(unread?.count ?? 0);
  if ((unread?.count ?? 0) !== seen) {
    setSeen(unread?.count ?? 0);
    setCount(unread?.count ?? 0);
  }
  const endpoint = unread?.endpoint;
  useEffect(() => {
    if (!endpoint) return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { count?: unknown };
        if (typeof body.count === "number") setCount(body.count);
      } catch {
        /* offline or restarting: try again next tick */
      }
    };
    const timer = setInterval(() => void check(), UNREAD_POLL_MS);
    const onVisible = () => void check(); // catch up the moment the tab comes back
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [endpoint]);
  // Longest matching href wins so /settings/users doesn't also light up /settings.
  const active = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
      {items.map((item) => {
        const Icon = ICONS[item.label] ?? FileText;
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
            {unread && item.href === unread.href && !isActive && badgeLabel(count) && (
              <span
                className="bg-primary text-primary-foreground ml-auto rounded-full px-1.5 py-0.5 text-xs leading-none font-semibold"
                aria-label={`${count} unread`}
              >
                {badgeLabel(count)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
