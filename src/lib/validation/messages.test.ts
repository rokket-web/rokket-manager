import { describe, expect, it } from "vitest";
import { clientEmailInputSchema, messageInputSchema } from "./messages";

describe("messageInputSchema", () => {
  it("trims and accepts a normal message", () => {
    expect(messageInputSchema.parse({ body: "  hello  " }).body).toBe("hello");
  });
  it("rejects empty and whitespace-only bodies", () => {
    expect(messageInputSchema.safeParse({ body: "" }).success).toBe(false);
    expect(messageInputSchema.safeParse({ body: "   \n " }).success).toBe(false);
  });
  it("rejects over-long bodies", () => {
    expect(messageInputSchema.safeParse({ body: "x".repeat(5001) }).success).toBe(false);
  });
});

describe("clientEmailInputSchema", () => {
  it("accepts a subject and body", () => {
    expect(clientEmailInputSchema.safeParse({ subject: "Hi", body: "There" }).success).toBe(true);
  });
  it("rejects header-injection style subjects", () => {
    expect(clientEmailInputSchema.safeParse({ subject: "Hi\r\nBcc: x@y.z", body: "There" }).success).toBe(false);
  });
  it("requires subject and body", () => {
    expect(clientEmailInputSchema.safeParse({ subject: "", body: "x" }).success).toBe(false);
    expect(clientEmailInputSchema.safeParse({ subject: "x", body: "" }).success).toBe(false);
  });
});
