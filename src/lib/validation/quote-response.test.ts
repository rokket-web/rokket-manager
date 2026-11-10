import { describe, expect, it } from "vitest";
import { portalQuoteResponseSchema, revisedQuoteNoteSchema } from "./quote-response";

describe("portalQuoteResponseSchema", () => {
  it("accepts accept/decline with or without a note", () => {
    expect(portalQuoteResponseSchema.parse({ response: "ACCEPTED" })).toEqual({ response: "ACCEPTED", note: undefined });
    expect(portalQuoteResponseSchema.parse({ response: "DECLINED", note: " too pricey " }).note).toBe("too pricey");
  });
  it("treats a blank note as no note", () => {
    expect(portalQuoteResponseSchema.parse({ response: "ACCEPTED", note: "   " }).note).toBeUndefined();
  });
  it("requires a note to request edits", () => {
    expect(portalQuoteResponseSchema.safeParse({ response: "CHANGES_REQUESTED" }).success).toBe(false);
    expect(portalQuoteResponseSchema.safeParse({ response: "CHANGES_REQUESTED", note: "  " }).success).toBe(false);
    expect(portalQuoteResponseSchema.safeParse({ response: "CHANGES_REQUESTED", note: "Remove line 3" }).success).toBe(true);
  });
  it("rejects unknown responses and over-long notes", () => {
    expect(portalQuoteResponseSchema.safeParse({ response: "MAYBE" }).success).toBe(false);
    expect(portalQuoteResponseSchema.safeParse({ response: "ACCEPTED", note: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("revisedQuoteNoteSchema", () => {
  it("allows an empty note and trims", () => {
    expect(revisedQuoteNoteSchema.parse({}).note).toBeUndefined();
    expect(revisedQuoteNoteSchema.parse({ note: " hi " }).note).toBe("hi");
  });
});
