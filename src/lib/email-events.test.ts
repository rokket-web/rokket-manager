import { describe, expect, it } from "vitest";
import { nextEmailStatus, normalizeMessageId, parseMailgunEvent } from "./email-events";

const ev = (over: Record<string, unknown> = {}, id: unknown = "<abc@mg.example.com>") => ({
  "event-data": { event: "delivered", message: { headers: { "message-id": id } }, ...over },
});

describe("normalizeMessageId", () => {
  it("strips angle brackets and whitespace", () => {
    expect(normalizeMessageId(" <abc@mg.x.com> ")).toBe("abc@mg.x.com");
    expect(normalizeMessageId("abc@mg.x.com")).toBe("abc@mg.x.com");
  });
  it("rejects non-strings and empties", () => {
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId("<>")).toBeNull();
    expect(normalizeMessageId(42)).toBeNull();
  });
});

describe("parseMailgunEvent", () => {
  it("parses delivered", () => {
    expect(parseMailgunEvent(ev())).toEqual({ event: "delivered", messageId: "abc@mg.example.com", reason: null });
  });
  it("parses permanent failures with a trimmed reason", () => {
    const r = parseMailgunEvent(
      ev({ event: "failed", severity: "permanent", "delivery-status": { description: "  No such\nuser  ", message: "550" } }),
    );
    expect(r).toEqual({ event: "bounced", messageId: "abc@mg.example.com", reason: "No such user" });
  });
  it("ignores temporary failures, opens, and accepted", () => {
    expect(parseMailgunEvent(ev({ event: "failed", severity: "temporary" }))).toBeNull();
    expect(parseMailgunEvent(ev({ event: "opened" }))).toBeNull();
    expect(parseMailgunEvent(ev({ event: "accepted" }))).toBeNull();
  });
  it("parses complaints", () => {
    expect(parseMailgunEvent(ev({ event: "complained" }))?.event).toBe("complained");
  });
  it("returns null for malformed payloads", () => {
    expect(parseMailgunEvent(null)).toBeNull();
    expect(parseMailgunEvent({})).toBeNull();
    expect(parseMailgunEvent(ev({}, null))).toBeNull();
  });
});

describe("nextEmailStatus", () => {
  it("moves forward only", () => {
    expect(nextEmailStatus("SENT", "delivered")).toBe("DELIVERED");
    expect(nextEmailStatus("SENT", "bounced")).toBe("BOUNCED");
    expect(nextEmailStatus("DELIVERED", "complained")).toBe("COMPLAINED");
    expect(nextEmailStatus("DELIVERED", "delivered")).toBeNull();
    expect(nextEmailStatus("BOUNCED", "delivered")).toBeNull();
    expect(nextEmailStatus("COMPLAINED", "bounced")).toBeNull();
  });
  it("never touches rows that failed to send", () => {
    expect(nextEmailStatus("FAILED", "delivered")).toBeNull();
  });
});
