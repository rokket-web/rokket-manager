import { describe, expect, it } from "vitest";
import { sharedProgress } from "./progress";

describe("sharedProgress", () => {
  it("rounds and handles empty", () => {
    expect(sharedProgress(0, 0)).toBeNull();
    expect(sharedProgress(1, 3)).toBe(33);
    expect(sharedProgress(2, 3)).toBe(67);
    expect(sharedProgress(5, 5)).toBe(100);
  });
});
