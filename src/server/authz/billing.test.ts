import { describe, expect, it } from "vitest";
import { canBilling } from "./billing";

describe("billing policy", () => {
  it("is admin-only", () => {
    for (const a of ["billing:read", "billing:write"] as const) {
      expect(canBilling("ADMIN", a)).toBe(true);
      expect(canBilling("STAFF", a)).toBe(false);
      expect(canBilling("CLIENT", a)).toBe(false);
    }
  });
});
