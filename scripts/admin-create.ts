import "./load-env"; // must be first: db client reads DATABASE_URL at import time
import readline from "node:readline";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db } from "../src/server/db";
import { audit } from "../src/server/audit";

// Creates (or refuses to duplicate) an ADMIN user. Safe for production: it never
// prints or stores the password. Interactive by default; ADMIN_EMAIL, ADMIN_NAME and
// ADMIN_PASSWORD env vars skip the prompts (e.g. for a one-off shell session).

function ask(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void };
      out._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? (await ask("Admin email: "))).toLowerCase();
  const name = process.env.ADMIN_NAME ?? (await ask("Admin name: "));
  const password = process.env.ADMIN_PASSWORD ?? (await ask("Password (min 12 chars): ", true));
  if (!process.env.ADMIN_PASSWORD) {
    const again = await ask("Confirm password: ", true);
    if (again !== password) throw new Error("Passwords do not match.");
  }

  const input = z
    .object({ email: z.string().email(), name: z.string().min(1).max(100), password: z.string().min(12).max(128) })
    .parse({ email, name, password });

  if (await db.user.findUnique({ where: { email: input.email } })) {
    throw new Error(`A user with ${input.email} already exists. Nothing changed.`);
  }

  const hash = await hashPassword(input.password);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: input.name, email: input.email, role: "ADMIN", emailVerified: true },
    });
    await tx.account.create({
      data: { userId: created.id, accountId: created.id, providerId: "credential", password: hash },
    });
    await audit(
      {
        actorId: null,
        action: "user.create",
        entity: "User",
        entityId: created.id,
        meta: { role: "ADMIN", via: "admin:create" },
      },
      tx,
    );
    return created;
  });
  console.info(`Created admin ${user.email} (${user.id}).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
