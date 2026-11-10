import { describe, expect, it, vi } from "vitest";
import { createMailgunMailer, escapeHtml, MailDeliveryError } from "./index";

describe("mailgun mailer", () => {
  const cfg = { apiKey: "key-secret", domain: "mg.example.com", from: "Rokket <billing@mg.example.com>" };

  it("posts a multipart message with basic auth and an attachment", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await createMailgunMailer(cfg, fetchMock as unknown as typeof fetch).send({
      to: "a@b.com",
      subject: "Hi\r\nBcc: evil@x.com",
      text: "body",
      attachments: [{ filename: "INV-0001.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("api:key-secret").toString("base64")}`);
    const form = init.body as FormData;
    expect(form.get("to")).toBe("a@b.com");
    expect(form.get("subject")).toBe("Hi Bcc: evil@x.com"); // header injection neutralised
    expect((form.get("attachment") as File).name).toBe("INV-0001.pdf");
  });

  it("returns Mailgun's message id so webhook events can be matched", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "<abc@mg.example.com>", message: "Queued." }), { status: 200 }));
    const receipt = await createMailgunMailer(cfg, fetchMock as unknown as typeof fetch).send({ to: "a@b.com", subject: "s", text: "t" });
    expect(receipt).toEqual({ id: "<abc@mg.example.com>" });
  });

  it("throws a delivery error without leaking the key or response body", async () => {
    const fetchMock = vi.fn(async () => new Response("key-secret leaked", { status: 401 }));
    const err = await createMailgunMailer(cfg, fetchMock as unknown as typeof fetch)
      .send({ to: "a@b.com", subject: "s", text: "t" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(MailDeliveryError);
    expect(String(err.message)).not.toContain("key-secret");
  });

  it("escapes html", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
