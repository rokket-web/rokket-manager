import { expect, test, type Page } from "@playwright/test";
import { closeDb, newId, sql } from "./helpers/db";

const PASSWORD = process.env.SEED_PASSWORD ?? "";
const T = Date.now();
const CLIENT = `E2E Flat Client ${T}`;
const PROJECT = `E2E Flat Project ${T}`;
const clientId = newId();

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)/);
}
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name, exact: true });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql(`INSERT INTO "Client" ("id","name","taxRateBps","updatedAt") VALUES ($1,$2,0,now())`, [clientId, CLIENT]);
});
test.afterAll(async () => {
  await sql(`DELETE FROM "AuditLog" WHERE "entityId" IN (SELECT "id" FROM "Invoice" WHERE "clientId"=$1 UNION SELECT "id" FROM "Project" WHERE "clientId"=$1)`, [clientId]);
  await sql(`DELETE FROM "Invoice" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "Project" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "Activity" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "Client" WHERE "id"=$1`, [clientId]);
  await closeDb();
});

test("flat-fee project: standard billing, adjust, invoice an installment", async ({ page }) => {
  await login(page, "admin@rokket.test");

  // a flat-fee project needs its fee
  await page.goto("/projects/new");
  await page.getByLabel("Client").selectOption({ label: CLIENT });
  await page.getByLabel("Project name").fill(PROJECT);
  await page.getByLabel("Billing").selectOption("FLAT_FEE");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("Enter the flat fee for this project")).toBeVisible();
  await page.getByLabel("Flat fee (USD)").fill("10000");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible();
  await expect(page.getByText("$10,000.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Invoice time" })).toHaveCount(0); // not for flat-fee projects

  // standard billing: 40 / 40 / 20
  await tab(page, "Billing").click();
  await expect(page.getByText("No billing plan yet.")).toBeVisible();
  await page.getByRole("button", { name: "Create standard billing" }).click();
  await expect(page.getByText("Standard billing created: 40% / 40% / 20%.")).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row").nth(1)).toContainText("$4,000.00");
  await expect(table.getByRole("row").nth(2)).toContainText("$4,000.00");
  await expect(table.getByRole("row").nth(3)).toContainText("$2,000.00");
  await expect(page.getByRole("button", { name: "Create standard billing" })).toHaveCount(0); // only once

  // adjust: 50 / 50
  await page.getByRole("button", { name: "Remove installment 3" }).click();
  await page.getByLabel("Installment 1 percent").fill("50");
  await page.getByLabel("Installment 2 percent").fill("50");
  await expect(page.getByText("Total 100%")).toBeVisible();
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByText("Plan saved.")).toBeVisible();
  await expect(table.getByRole("row").nth(1)).toContainText("$5,000.00");
  await expect(table.getByRole("row")).toHaveCount(3); // header + 2

  // an unbalanced plan is rejected and the live total warns first
  await page.getByLabel("Installment 2 percent").fill("40");
  await expect(page.getByText("(must be 100%)")).toBeVisible();
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByText(/must add up to 100%/)).toBeVisible();
  await page.getByLabel("Installment 2 percent").fill("50");

  // invoice installment 1 -> draft invoice at $5,000
  await page.getByRole("button", { name: "Create invoice for Installment 1 of 3" }).click();
  await expect(page.getByRole("heading", { name: /Invoice \(draft\)/ })).toBeVisible();
  await expect(page.getByText("$5,000.00").first()).toBeVisible();
  await expect(page.getByText(/Installment 1 of 3/).first()).toBeVisible();

  // back on the plan: installment 1 shows its invoice and is locked; its Create button is gone
  await page.goto(`/projects/${(await sql<{ id: string }>(`SELECT "id" FROM "Project" WHERE "name"=$1`, [PROJECT]))[0].id}?tab=billing`);
  await expect(table.getByRole("row").nth(1)).toContainText("Draft");
  await expect(page.getByRole("button", { name: "Create invoice for Installment 1 of 3" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create invoice for Installment 2 of 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove plan" })).toHaveCount(0); // billing has started
});

test("staff do not see the Billing tab or the flat fee", async ({ page }) => {
  const [proj] = await sql<{ id: string }>(`SELECT "id" FROM "Project" WHERE "name"=$1`, [PROJECT]);
  await sql(`INSERT INTO "ProjectMember" ("projectId","userId") SELECT $1,"id" FROM "User" WHERE "email"='staff@rokket.test'`, [proj.id]);
  await login(page, "staff@rokket.test");
  await page.goto(`/projects/${proj.id}`);
  await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible();
  await expect(tab(page, "Billing")).toHaveCount(0);
  await expect(page.getByText("$10,000.00")).toHaveCount(0);
  await page.goto(`/projects/${proj.id}?tab=billing`);
  await expect(page.getByRole("button", { name: /Create invoice for/ })).toHaveCount(0);
});
