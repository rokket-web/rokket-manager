export type Role = "ADMIN" | "STAFF" | "CLIENT";

/** Route areas and which roles may enter them. Pure, so it is unit-tested. */
const AREAS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/portal", roles: ["CLIENT"] },
  { prefix: "/settings/users", roles: ["ADMIN"] },
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
  { label: "Settings", href: "/settings", roles: ["ADMIN", "STAFF"] },
  { label: "Users", href: "/settings/users", roles: ["ADMIN"] },
  { label: "My Portal", href: "/portal", roles: ["CLIENT"] },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}
