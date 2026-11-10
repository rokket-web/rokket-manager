import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MailgunWebhookError, verifyMailgunSignature } from "./mailgun-webhook";

const key = "signing-key";
const now = 1_800_000_000_000;
const sign = (timestamp: string, token: string) => createHmac("sha256", key).update(timestamp + token).digest("hex");
const ts = String(now / 1000);

describe("verifyMailgunSignature", () => {
  it("accepts a correct, fresh signature", () => {
    expect(() => verifyMailgunSignature({ timestamp: ts, token: "t", signature: sign(ts, "t") }, key, now)).not.toThrow();
  });
  it("rejects a wrong signature, wrong key and tampered token", () => {
    const bad = (sig: Parameters<typeof verifyMailgunSignature>[0], k = key) =>
      expect(() => verifyMailgunSignature(sig, k, now)).toThrow(MailgunWebhookError);
    bad({ timestamp: ts, token: "t", signature: "0".repeat(64) });
    bad({ timestamp: ts, token: "t", signature: sign(ts, "t") }, "other-key");
    bad({ timestamp: ts, token: "t2", signature: sign(ts, "t") });
  });
  it("rejects stale timestamps", () => {
    const old = String(now / 1000 - 3600);
    expect(() => verifyMailgunSignature({ timestamp: old, token: "t", signature: sign(old, "t") }, key, now)).toThrow(/Stale/);
  });
  it("rejects missing fields and reports 503 when no key is configured", () => {
    expect(() => verifyMailgunSignature({}, key, now)).toThrow(/Missing/);
    expect(() => verifyMailgunSignature(null, key, now)).toThrow(/Missing/);
    try {
      verifyMailgunSignature({ timestamp: ts, token: "t", signature: sign(ts, "t") }, undefined, now);
    } catch (e) {
      expect((e as MailgunWebhookError).status).toBe(503);
    }
  });
});
