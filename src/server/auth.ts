import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { sendPortalLink } from "@/server/portal-mail";

// Better Auth rate-limits sign-in in production. E2E runs log in many times in parallel, so allow turning it
// off, but ONLY when the app URL is localhost. Real deployments can never disable it by accident.
const rateLimitOff =
  process.env.RATE_LIMIT_OFF === "1" && (process.env.BETTER_AUTH_URL ?? "").startsWith("http://localhost");

export const auth = betterAuth({
  rateLimit: { enabled: !rateLimitOff },
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // users are created by an Admin, never self-registered
    minPasswordLength: 12,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "STAFF", input: false },
      active: { type: "boolean", required: false, defaultValue: true, input: false },
      clientId: { type: "string", required: false, input: false },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await audit({
            actorId: session.userId,
            action: "auth.login",
            entity: "User",
            entityId: session.userId,
            ip: session.ipAddress,
          });
        },
      },
    },
  },
  plugins: [
    magicLink({
      disableSignUp: true, // clients are invited by an admin, never self-registered
      expiresIn: 60 * 60, // 1 hour, single use
      sendMagicLink: async ({ email, url }) => {
        await sendPortalLink(email, url);
      },
    }),
    nextCookies(), // keep last
  ],
});
