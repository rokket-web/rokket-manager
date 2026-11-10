"use client";
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

export function NavLinks({ items }: { items: { label: string; href: string }[] }) {
  const pathname = usePathname();
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
          </Link>
        );
      })}
    </nav>
  );
}
