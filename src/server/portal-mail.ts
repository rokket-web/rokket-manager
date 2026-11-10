import { db } from "@/server/db";
import { appBaseUrl } from "@/server/app-url";
import { MailNotConfiguredError, escapeHtml, getMailer } from "@/server/mail";
import { readCompanyProfile } from "@/server/services/settings";

/**
 * Better Auth calls this for every magic-link request. Only active CLIENT users with a portal client get an email;
 * staff/admin use passwords, and unknown addresses get nothing (the caller always shows the same message).
 */
export async function sendPortalLink(email: string, url: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { name: true, role: true, active: true, clientId: true },
  });
  if (!user || user.role !== "CLIENT" || !user.active || !user.clientId) return;

  let invited = false;
  try {
    invited = (new URL(url).searchParams.get("callbackURL") ?? "").includes("invited=1");
  } catch {
    /* malformed URL: treat as a normal sign-in link */
  }
  const company = await readCompanyProfile();
  const lines = [
    `Hello ${user.name},`,
    invited
      ? `${company.name} has invited you to your client portal, where you can see your projects, quotes and invoices.`
      : `Use the link below to sign in to your ${company.name} client portal.`,
    url,
    `This link works once and expires in 1 hour. If it has expired, request a new one any time at ${appBaseUrl()}/login (choose "Client? Use an email link instead").`,
    "If you did not expect this email, you can ignore it.",
  ];

  if (process.env.NODE_ENV !== "production") console.info(`[magic-link] ${email}: ${url}`);
  let mailer;
  try {
    mailer = getMailer();
  } catch (e) {
    if (e instanceof MailNotConfiguredError && process.env.NODE_ENV !== "production") return; // dev: link is in the log
    throw e;
  }
  await mailer.send({
    to: email,
    subject: invited ? `You're invited to the ${company.name} client portal` : `Your ${company.name} sign-in link`,
    text: lines.join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1f">${lines
      .map((l) =>
        l === url
          ? `<p style="margin:0 0 12px"><a href="${escapeHtml(url)}">Sign in to the portal</a></p>`
          : `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`,
      )
      .join("")}</div>`,
    replyTo: company.email,
  });
}
