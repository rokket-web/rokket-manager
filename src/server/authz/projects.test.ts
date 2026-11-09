import { describe, expect, it } from "vitest";
import { assertProject, canProject, projectScope } from "./projects";
import { ForbiddenError } from "@/server/errors";

describe("project permissions", () => {
  it("admin can do everything, including see money", () => {
    for (const a of ["project:read", "project:write", "task:write", "time:write", "file:write", "money:read"] as const)
      expect(canProject("ADMIN", a)).toBe(true);
  });
  it("staff can work on projects but not manage them or see money", () => {
    for (const a of ["project:read", "task:write", "time:write", "file:write"] as const)
      expect(canProject("STAFF", a)).toBe(true);
    for (const a of ["project:write", "money:read"] as const) expect(canProject("STAFF", a)).toBe(false);
  });
  it("portal clients have no internal project access", () => {
    for (const a of ["project:read", "task:write", "time:write", "file:write", "money:read", "project:write"] as const)
      expect(canProject("CLIENT", a)).toBe(false);
    expect(() => assertProject({ id: "u", role: "CLIENT" }, "project:read")).toThrow(ForbiddenError);
  });
  it("scopes by membership", () => {
    expect(projectScope({ id: "a", role: "ADMIN" })).toEqual({});
    expect(projectScope({ id: "s1", role: "STAFF" })).toEqual({ members: { some: { userId: "s1" } } });
    expect(projectScope({ id: "c", role: "CLIENT" })).toEqual({ id: { in: [] } });
  });
});
