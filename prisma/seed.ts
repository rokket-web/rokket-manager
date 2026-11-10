import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { hashPassword } from "better-auth/crypto";
import { db } from "../src/server/db";

// Dev/test seed only. Refuses to run against production.
const USERS = [
  { name: "Josh Admin", email: "admin@rokket.test", role: "ADMIN" as const },
  { name: "Sam Staff", email: "staff@rokket.test", role: "STAFF" as const },
  { name: "Casey Client", email: "client@rokket.test", role: "CLIENT" as const },
];

const CLIENTS: [string, "LEAD" | "ACTIVE" | "PAST", string, string, number | null, string][] = [
  ["Acme Plumbing", "ACTIVE", "Home services", "wordpress, retainer", null, "Austin, TX"],
  ["Bluebird Bakery", "ACTIVE", "Food & beverage", "shopify", null, "Portland, OR"],
  ["Cedar Ridge Dental", "ACTIVE", "Healthcare", "wordpress, seo", null, "Denver, CO"],
  ["Delta Freight Co", "PAST", "Logistics", "custom", 0, "Memphis, TN"],
  ["Evergreen Landscaping", "LEAD", "Home services", "wordpress", null, "Seattle, WA"],
  ["Fable & Finch Books", "ACTIVE", "Retail", "shopify, seo", null, "Boston, MA"],
  ["Granite State Credit Union", "ACTIVE", "Finance", "custom, retainer", 0, "Concord, NH"],
  ["Harbor Light Yoga", "LEAD", "Wellness", "wordpress", null, "San Diego, CA"],
  ["Ironclad Roofing", "PAST", "Home services", "seo", null, "Dallas, TX"],
  ["Juniper Legal Group", "ACTIVE", "Legal", "wordpress, retainer", 825, "Chicago, IL"],
  ["Keystone Auto Repair", "LEAD", "Automotive", "seo", null, "Pittsburgh, PA"],
  ["Lumen Photography", "ACTIVE", "Creative", "shopify", null, "Nashville, TN"],
  ["Maple Street Pediatrics", "ACTIVE", "Healthcare", "wordpress, seo", null, "Madison, WI"],
  ["Northwind Outfitters", "LEAD", "Retail", "shopify", null, "Boise, ID"],
  ["Orchard Hill Farms", "PAST", "Agriculture", "wordpress", null, "Burlington, VT"],
  ["Pinnacle Realty", "ACTIVE", "Real estate", "custom, retainer, seo", null, "Phoenix, AZ"],
  ["Quartz Analytics", "LEAD", "Technology", "custom", null, "Raleigh, NC"],
  ["Redwood Coffee Roasters", "ACTIVE", "Food & beverage", "shopify, retainer", null, "Santa Cruz, CA"],
  ["Summit Fitness", "PAST", "Wellness", "wordpress", null, "Salt Lake City, UT"],
  ["Tidewater Marine", "ACTIVE", "Marine", "wordpress, seo", 600, "Norfolk, VA"],
];
const FIRST = ["Alex", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Avery", "Quinn", "Parker", "Reese"];
const LAST = ["Nguyen", "Patel", "Garcia", "Smith", "Johnson", "Lee", "Brown", "Martinez", "Kim", "Davis"];

/** The seeded portal user belongs to Acme Plumbing so the portal is usable in dev. Never overrides an existing link. */
async function linkSeedPortalUser() {
  const [user, client] = await Promise.all([
    db.user.findUnique({ where: { email: "client@rokket.test" } }),
    db.client.findFirst({ where: { name: "Acme Plumbing" } }),
  ]);
  if (user && client && !user.clientId) await db.user.update({ where: { id: user.id }, data: { clientId: client.id } });
}

async function seedClients() {
  const admin = await db.user.findUnique({ where: { email: "admin@rokket.test" } });
  let created = 0;
  for (const [i, [name, status, industry, tagStr, taxRateBps, loc]] of CLIENTS.entries()) {
    if (await db.client.findFirst({ where: { name } })) continue;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const [city, state] = loc.split(", ");
    const client = await db.client.create({
      data: {
        name,
        status,
        industry,
        city,
        state,
        country: "US",
        taxRateBps,
        email: `hello@${slug}.example`,
        phone: `555-01${String(i).padStart(2, "0")}`,
        website: `https://${slug}.example`,
      },
    });
    for (const t of tagStr.split(", ")) {
      const tag = await db.tag.upsert({ where: { name: t }, update: {}, create: { name: t } });
      await db.clientTag.create({ data: { clientId: client.id, tagId: tag.id } });
    }
    for (let k = 0; k < 1 + (i % 3); k++) {
      const firstName = FIRST[(i + k) % FIRST.length];
      const lastName = LAST[(i * 3 + k) % LAST.length];
      await db.contact.create({
        data: {
          clientId: client.id,
          firstName,
          lastName,
          email: `${firstName}.${lastName}@${slug}.example`.toLowerCase(),
          title: k === 0 ? "Owner" : "Manager",
          isPrimary: k === 0,
        },
      });
    }
    await db.note.create({
      data: {
        clientId: client.id,
        authorId: admin?.id,
        body: `Initial call notes for ${name}. Interested in a refresh of their web presence.`,
      },
    });
    await db.activity.create({
      data: {
        clientId: client.id,
        actorId: admin?.id,
        type: "client.created",
        summary: `Client created as ${status.toLowerCase()}`,
      },
    });
    created++;
  }
  console.info(`Seeded ${created} new clients (${CLIENTS.length} total defined).`);
}

const PROJECTS: [string, string, "PLANNING" | "ACTIVE" | "COMPLETED", number, number, boolean][] = [
  ["Acme Plumbing", "Website redesign", "ACTIVE", 800000, 9500, true],
  ["Bluebird Bakery", "Online store build", "ACTIVE", 1200000, 9500, true],
  ["Cedar Ridge Dental", "SEO retainer", "ACTIVE", 300000, 8500, false],
  ["Fable & Finch Books", "Shopify migration", "PLANNING", 950000, 9500, true],
  ["Juniper Legal Group", "Intranet portal", "ACTIVE", 2000000, 11000, false],
  ["Pinnacle Realty", "Listings integration", "COMPLETED", 1500000, 10500, true],
];

async function seedProjects() {
  const [admin, staff] = await Promise.all([
    db.user.findUnique({ where: { email: "admin@rokket.test" } }),
    db.user.findUnique({ where: { email: "staff@rokket.test" } }),
  ]);
  if (!admin || !staff) return;
  const day = 86_400_000;
  const at = (n: number) => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").getTime() + n * day;
  let created = 0;
  for (const [clientName, name, status, budgetCents, rate, withStaff] of PROJECTS) {
    const client = await db.client.findFirst({ where: { name: clientName } });
    if (!client || (await db.project.findFirst({ where: { clientId: client.id, name } }))) continue;
    const project = await db.project.create({
      data: {
        clientId: client.id,
        name,
        status,
        budgetCents,
        hourlyRateCents: rate,
        startDate: new Date(at(-30)),
        dueDate: new Date(at(30)),
      },
    });
    const members = withStaff ? [admin.id, staff.id] : [admin.id];
    await db.projectMember.createMany({ data: members.map((userId) => ({ projectId: project.id, userId })) });
    const m1 = await db.milestone.create({
      data: {
        projectId: project.id,
        title: "Discovery & design",
        status: "COMPLETED",
        dueDate: new Date(at(-10)),
        position: 0,
        billableCents: Math.round(budgetCents / 4),
        completedAt: new Date(at(-9)),
      },
    });
    const m2 = await db.milestone.create({
      data: {
        projectId: project.id,
        title: "Build & launch",
        status: "IN_PROGRESS",
        dueDate: new Date(at(12)),
        position: 1,
        billableCents: Math.round(budgetCents / 2),
      },
    });
    const tasks: [
      string,
      "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE",
      "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      string,
      number | null,
    ][] = [
      ["Kickoff call", "DONE", "MEDIUM", m1.id, -25],
      ["Wireframes", "DONE", "HIGH", m1.id, -15],
      ["Homepage build", "IN_PROGRESS", "HIGH", m2.id, 5],
      ["Content migration", "TODO", "MEDIUM", m2.id, 9],
      ["QA pass", "TODO", "LOW", m2.id, 11],
      ["Client review", "REVIEW", "URGENT", m2.id, -2],
    ];
    for (const [title, tStatus, priority, milestoneId, due] of tasks) {
      await db.task.create({
        data: {
          projectId: project.id,
          milestoneId,
          title,
          status: tStatus,
          priority,
          assigneeId: withStaff ? staff.id : admin.id,
          dueDate: due == null ? null : new Date(at(due)),
          completedAt: tStatus === "DONE" ? new Date(at(-5)) : null,
        },
      });
    }
    for (let d = 1; d <= 6; d++) {
      const userId = withStaff && d % 2 ? staff.id : admin.id;
      const minutes = 60 + d * 20;
      const startedAt = new Date(at(-d) + 14 * 3_600_000);
      await db.timeEntry.create({
        data: {
          projectId: project.id,
          userId,
          startedAt,
          endedAt: new Date(startedAt.getTime() + minutes * 60_000),
          minutes,
          billable: d !== 4,
          rateCents: rate,
          description: "Seeded work session",
        },
      });
    }
    created++;
  }
  console.info(`Seeded ${created} new projects.`);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set SEED_PASSWORD (min 12 chars) in .env.local.");
  const hash = await hashPassword(password);

  for (const u of USERS) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, active: true },
      create: { name: u.name, email: u.email, role: u.role, emailVerified: true },
    });
    const existing = await db.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
    if (existing) await db.account.update({ where: { id: existing.id }, data: { password: hash } });
    else
      await db.account.create({
        data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash },
      });
  }
  await seedClients();
  await linkSeedPortalUser();
  await seedProjects();
  await db.setting.upsert({
    where: { key: "defaultTaxRateBps" },
    update: {},
    create: { key: "defaultTaxRateBps", value: 0 },
  });
  console.info(`Seeded ${USERS.length} users: ${USERS.map((u) => u.email).join(", ")}`);
}

main().finally(() => db.$disconnect());
