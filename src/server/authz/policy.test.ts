import { describe, expect, it } from "vitest";
import { canAccessPath, homeFor, navFor } from "./policy";

describe("canAccessPath", () => {
  it("lets admin and staff into internal areas, not the portal", () => {
    for (const role of ["ADMIN", "STAFF"] as const) {
      expect(canAccessPath(role, "/dashboard")).toBe(true);
      expect(canAccessPath(role, "/settings")).toBe(true);
      expect(canAccessPath(role, "/portal")).toBe(false);
      expect(canAccessPath(role, "/portal/invoices")).toBe(false);
    }
  });
  it("restricts user management to admin", () => {
    expect(canAccessPath("ADMIN", "/settings/users")).toBe(true);
    expect(canAccessPath("STAFF", "/settings/users")).toBe(false);
    expect(canAccessPath("CLIENT", "/settings/users")).toBe(false);
  });
  it("keeps clients out of every internal area", () => {
    for (const p of ["/dashboard", "/settings", "/settings/users"]) expect(canAccessPath("CLIENT", p)).toBe(false);
    expect(canAccessPath("CLIENT", "/portal")).toBe(true);
  });
  it("denies anonymous users on guarded paths", () => {
    for (const p of ["/dashboard", "/portal", "/settings"]) expect(canAccessPath(null, p)).toBe(false);
  });
  it("limits client create/import pages to admin and the client area to internal roles", () => {
    expect(canAccessPath("ADMIN", "/clients/new")).toBe(true);
    expect(canAccessPath("STAFF", "/clients/new")).toBe(false);
    expect(canAccessPath("STAFF", "/clients/import")).toBe(false);
    expect(canAccessPath("STAFF", "/clients/abc")).toBe(true);
    expect(canAccessPath("CLIENT", "/clients")).toBe(false);
    expect(canAccessPath("CLIENT", "/clients/abc")).toBe(false);
  });
  it("limits project creation to admin and project/time areas to internal roles", () => {
    expect(canAccessPath("ADMIN", "/projects/new")).toBe(true);
    expect(canAccessPath("STAFF", "/projects/new")).toBe(false);
    expect(canAccessPath("STAFF", "/projects/abc")).toBe(true);
    expect(canAccessPath("STAFF", "/time")).toBe(true);
    for (const p of ["/projects", "/projects/abc", "/time"]) expect(canAccessPath("CLIENT", p)).toBe(false);
  });
  it("keeps quotes and invoices admin-only", () => {
    for (const p of ["/quotes", "/quotes/new", "/quotes/abc", "/invoices", "/invoices/abc/edit", "/invoices/from-time"]) {
      expect(canAccessPath("ADMIN", p)).toBe(true);
      expect(canAccessPath("STAFF", p)).toBe(false);
      expect(canAccessPath("CLIENT", p)).toBe(false);
      expect(canAccessPath(null, p)).toBe(false);
    }
  });
  it("keeps the portal client-only, including its documents", () => {
    for (const p of ["/portal", "/portal/projects", "/portal/projects/abc", "/portal/quotes", "/portal/invoices/abc"]) {
      expect(canAccessPath("CLIENT", p)).toBe(true);
      expect(canAccessPath("ADMIN", p)).toBe(false);
      expect(canAccessPath("STAFF", p)).toBe(false);
      expect(canAccessPath(null, p)).toBe(false);
    }
  });
  it("does not match look-alike prefixes", () => {
    expect(canAccessPath("CLIENT", "/portalx")).toBe(true); // not the portal area; unlisted
    expect(canAccessPath("CLIENT", "/dashboardx")).toBe(true);
  });
});

describe("navFor / homeFor", () => {
  it("shows role-appropriate navigation", () => {
    expect(navFor("ADMIN").map((n) => n.label)).toEqual([
      "Dashboard",
      "Clients",
      "Projects",
      "Time",
      "Quotes",
      "Invoices",
      "Settings",
      "Users",
    ]);
    expect(navFor("STAFF").map((n) => n.label)).toEqual(["Dashboard", "Clients", "Projects", "Time", "Settings"]);
    expect(navFor("CLIENT").map((n) => n.label)).toEqual(["Overview", "Projects", "Quotes", "Invoices"]);
  });
  it("routes each role home", () => {
    expect(homeFor("CLIENT")).toBe("/portal");
    expect(homeFor("ADMIN")).toBe("/dashboard");
  });
});
