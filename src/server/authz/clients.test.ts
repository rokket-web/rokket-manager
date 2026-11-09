import { describe, expect, it } from "vitest";
import { assertCan, can, clientScope } from "./clients";
import { ForbiddenError } from "@/server/errors";

describe("client permissions", () => {
  it("admin can do everything", () => {
    for (const a of ["client:read", "client:write", "client:delete", "client:import", "client:export"] as const)
      expect(can("ADMIN", a)).toBe(true);
  });
  it("staff are read-only", () => {
    expect(can("STAFF", "client:read")).toBe(true);
    for (const a of ["client:write", "client:delete", "client:import", "client:export"] as const)
      expect(can("STAFF", a)).toBe(false);
  });
  it("portal clients have no access to internal client services", () => {
    for (const a of ["client:read", "client:write", "client:delete", "client:import", "client:export"] as const)
      expect(can("CLIENT", a)).toBe(false);
    expect(() => assertCan({ id: "u", role: "CLIENT" }, "client:read")).toThrow(ForbiddenError);
  });
  it("scopes staff to nothing until projects exist, admin to everything", () => {
    expect(clientScope({ id: "u", role: "ADMIN" })).toEqual({});
    expect(clientScope({ id: "u", role: "STAFF" })).toEqual({ id: { in: [] } });
    expect(clientScope({ id: "u", role: "CLIENT" })).toEqual({ id: { in: [] } });
  });
});
