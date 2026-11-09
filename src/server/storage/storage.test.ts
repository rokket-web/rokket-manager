import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGcsStorage } from "./index";

// Signing happens locally with the private key, so this needs no network or real bucket.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const storage = createGcsStorage("test-bucket", {
  client_email: "svc@test-project.iam.gserviceaccount.com",
  private_key: privateKey,
});

describe("GCS signed URLs", () => {
  it("creates a short-lived v4 upload URL bound to the content type", async () => {
    const url = new URL(await storage.createUploadUrl("clients/c1/general/abc-file.pdf", { mime: "application/pdf" }));
    expect(url.hostname).toBe("storage.googleapis.com");
    expect(url.pathname).toBe("/test-bucket/clients/c1/general/abc-file.pdf");
    expect(url.searchParams.get("X-Goog-Algorithm")).toBe("GOOG4-RSA-SHA256");
    expect(url.searchParams.get("X-Goog-Expires")).toBe("600");
    expect(url.searchParams.get("X-Goog-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Goog-Signature")).toMatch(/^[0-9a-f]+$/);
  });
  it("creates a 5-minute download URL that forces attachment", async () => {
    const url = new URL(await storage.createDownloadUrl("k/file.pdf", { filename: 'My "Report".pdf' }));
    expect(url.searchParams.get("X-Goog-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toContain("attachment");
    expect(url.searchParams.get("response-content-disposition")).not.toContain('"Report"');
  });
});
