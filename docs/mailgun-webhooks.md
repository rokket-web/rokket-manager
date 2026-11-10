# Mailgun delivery webhooks

The email log records every send as **Sent** (Mailgun accepted it). To see **Delivered**, **Bounced** and **Spam complaint**,
Mailgun has to tell the app what happened. Without this setup the log still works; rows just stay at "Sent".

## One-time setup

1. Mailgun dashboard -> **Sending** -> **Webhooks** (the **HTTP webhook signing key** is shown on this page; it is NOT the API key).
2. Copy that signing key into the `MAILGUN_WEBHOOK_SIGNING_KEY` env var (Render: Environment tab), then redeploy.
3. Add a webhook for each of these events, all pointing at the same URL:
   - **Delivered**
   - **Permanent Failure**
   - **Spam Complaints**

   URL: `https://<your-render-domain>/api/webhooks/mailgun`
4. Use Mailgun's **Test webhook** button. A signed test returns 200; a wrong key returns 401; a missing env var returns 503.

Temporary failures are ignored on purpose: Mailgun keeps retrying them and reports delivered or a permanent failure later.

## Notes

- Only emails sent through the app (and logged) can be matched. Events for other mail on the same domain are ignored (200).
- Status only moves forward (Sent -> Delivered -> Bounced/Complaint), so late or repeated events are harmless.
- Local testing needs a public URL (e.g. a tunnel) since Mailgun must reach the endpoint.
