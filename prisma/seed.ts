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
  await db.setting.upsert({
    where: { key: "defaultTaxRateBps" },
    update: {},
    create: { key: "defaultTaxRateBps", value: 0 },
  });
  console.info(`Seeded ${USERS.length} users: ${USERS.map((u) => u.email).join(", ")}`);
}

main().finally(() => db.$disconnect());
