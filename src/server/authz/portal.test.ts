import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/errors";
import { portalClientId } from "./portal";

describe("portalClientId", () => {
  it("returns the client's own id", () => {
    expect(portalClientId({ id: "u", role: "CLIENT", clientId: "c1" })).toBe("c1");
  });
  it("fails closed for everyone else", () => {
    expect(() => portalClientId({ id: "u", role: "CLIENT", clientId: null })).toThrow(ForbiddenError);
    expect(() => portalClientId({ id: "u", role: "ADMIN", clientId: "c1" })).toThrow(ForbiddenError);
    expect(() => portalClientId({ id: "u", role: "STAFF" })).toThrow(ForbiddenError);
  });
});
