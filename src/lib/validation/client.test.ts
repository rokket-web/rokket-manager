import { describe, expect, it } from "vitest";
import { clientInputSchema, contactInputSchema, listQuerySchema, normalizeTags } from "./client";

describe("clientInputSchema", () => {
  it("normalizes a minimal form submission", () => {
    const out = clientInputSchema.parse({
      name: "  Acme  ",
      status: "ACTIVE",
      email: "",
      taxRate: "",
      tags: " WordPress, retainer,wordpress ",
    });
    expect(out.name).toBe("Acme");
    expect(out.email).toBeNull();
    expect(out.taxRate).toBeNull();
    expect(out.tags).toEqual(["wordpress", "retainer"]);
  });
  it("converts tax percent to basis points and keeps 0 distinct from blank", () => {
    expect(clientInputSchema.parse({ name: "A", taxRate: "8.25" }).taxRate).toBe(825);
    expect(clientInputSchema.parse({ name: "A", taxRate: "0" }).taxRate).toBe(0);
  });
  it("rejects bad input", () => {
    expect(clientInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ name: "A", email: "nope" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ name: "A", taxRate: "abc" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ name: "A", status: "WHATEVER" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ name: "A", tags: "x".repeat(31) }).success).toBe(false);
    expect(clientInputSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
  });
});

describe("contact / list schemas", () => {
  it("requires a first name", () => {
    expect(contactInputSchema.safeParse({ firstName: "" }).success).toBe(false);
    expect(contactInputSchema.parse({ firstName: "Sam" }).isPrimary).toBe(false);
  });
  it("bounds pagination", () => {
    expect(listQuerySchema.parse({}).pageSize).toBe(20);
    expect(listQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(listQuerySchema.parse({ tag: " WordPress " }).tag).toBe("wordpress");
  });
});

describe("normalizeTags", () => {
  it("dedupes, lowercases and trims", () => {
    expect(normalizeTags("A, a ,  B  c ,,")).toEqual(["a", "b c"]);
  });
});

describe("boolish form booleans", () => {
  it('treats "false" as false (not truthy)', () => {
    expect(contactInputSchema.parse({ firstName: "A", isPrimary: "false" }).isPrimary).toBe(false);
    expect(contactInputSchema.parse({ firstName: "A", isPrimary: "true" }).isPrimary).toBe(true);
    expect(contactInputSchema.parse({ firstName: "A", isPrimary: "on" }).isPrimary).toBe(true);
    expect(contactInputSchema.parse({ firstName: "A" }).isPrimary).toBe(false);
  });
});
