import { describe, expect, it } from "vitest";
import { badgeLabel } from "./badge";

describe("badgeLabel", () => {
  it("hides the badge for zero, negatives and junk", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-3)).toBeNull();
    expect(badgeLabel(Number.NaN)).toBeNull();
  });
  it("shows the number up to nine, then 9+", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(250)).toBe("9+");
  });
});
