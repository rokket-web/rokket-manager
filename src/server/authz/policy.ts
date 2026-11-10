export type Role = "ADMIN" | "STAFF" | "CLIENT";

/** Route areas and which roles may enter them. Pure, so it is unit-tested. */
const AREAS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/portal", roles: ["CLIENT"] },
  { prefix: "/settings/users", roles: ["ADMIN"] },
  { prefix: "/quotes", roles: ["ADMIN"] },
  { prefix: "/invoices", roles: ["ADMIN"] },
  { prefix: "/projects/new", roles: ["ADMIN"] },
  { prefix: "/projects", roles: ["ADMIN", "STAFF"] },
  { prefix: "/time", roles: ["ADMIN", "STAFF"] },
  { prefix: "/clients/new", roles: ["ADMIN"] },
  { prefix: "/clients/import", roles: ["ADMIN"] },
  { prefix: "/clients", roles: ["ADMIN", "STAFF"] },
  { prefix: "/settings", roles: ["ADMIN", "STAFF"] },
  { prefix: "/dashboard", roles: ["ADMIN", "STAFF"] },
];

export function canAccessPath(role: Role | null | undefined, pathname: string): boolean {
  const area = AREAS.find((a) => pathname === a.prefix || pathname.startsWith(a.prefix + "/"));
  if (!area) return true; // unlisted paths are public or guarded elsewhere
  return !!role && area.roles.includes(role);
}

export function homeFor(role: Role): string {
  return role === "CLIENT" ? "/portal" : "/dashboard";
}

export type NavItem = { label: string; href: string; roles: Role[] };

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", roles: ["ADMIN", "STAFF"] },
  { label: "Clients", href: "/clients", roles: ["ADMIN", "STAFF"] },
  { label: "Projects", href: "/projects", roles: ["ADMIN", "STAFF"] },
  { label: "Time", href: "/time", roles: ["ADMIN", "STAFF"] },
  { label: "Quotes", href: "/quotes", roles: ["ADMIN"] },
  { label: "Invoices", href: "/invoices", roles: ["ADMIN"] },
  { label: "Settings", href: "/settings", roles: ["ADMIN", "STAFF"] },
  { label: "Users", href: "/settings/users", roles: ["ADMIN"] },
  { label: "Overview", href: "/portal", roles: ["CLIENT"] },
  { label: "Projects", href: "/portal/projects", roles: ["CLIENT"] },
  { label: "Quotes", href: "/portal/quotes", roles: ["CLIENT"] },
  { label: "Invoices", href: "/portal/invoices", roles: ["CLIENT"] },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}
