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
  it("does not match look-alike prefixes", () => {
    expect(canAccessPath("CLIENT", "/portalx")).toBe(true); // not the portal area; unlisted
    expect(canAccessPath("CLIENT", "/dashboardx")).toBe(true);
  });
});

describe("navFor / homeFor", () => {
  it("shows role-appropriate navigation", () => {
    expect(navFor("ADMIN").map((n) => n.label)).toEqual(["Dashboard", "Settings", "Users"]);
    expect(navFor("STAFF").map((n) => n.label)).toEqual(["Dashboard", "Settings"]);
    expect(navFor("CLIENT").map((n) => n.label)).toEqual(["My Portal"]);
  });
  it("routes each role home", () => {
    expect(homeFor("CLIENT")).toBe("/portal");
    expect(homeFor("ADMIN")).toBe("/dashboard");
  });
});
