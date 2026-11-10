import { expect, test, type Page } from "@playwright/test";
import { closeDb, newId, newToken, sql } from "./helpers/db";

/**
 * One serial file for everything that signs in as the seeded portal user: they are temporarily linked to a throwaway
 * client for the run (and restored after), so specs that do this must never run in parallel with each other.
 */
const PASSWORD = process.env.SEED_PASSWORD ?? "";
const T = Date.now();
const CLIENT = `E2E Portal Client ${T}`;
const QUOTE_LINE = `Quote work ${T}`;
const INVOICE_LINE = `Invoice work ${T}`;
const PROJECT = `E2E Shared Project ${T}`;
const UNSHARED = `E2E Unshared Project ${T}`;
const clientId = newId();
const projectId = newId();
const unsharedId = newId();
let caseyBefore: string | null = null;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)/);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql(`INSERT INTO "Client" ("id","name","billingEmail","taxRateBps","updatedAt") VALUES ($1,$2,'ap@e2e-portal.test',0,now())`, [clientId, CLIENT]);
  await sql(`INSERT INTO "Project" ("id","clientId","name","description","budgetCents","hourlyRateCents","updatedAt") VALUES ($1,$2,$3,'Visible description',654321,98765,now())`, [projectId, clientId, PROJECT]);
  await sql(`INSERT INTO "Project" ("id","clientId","name","updatedAt") VALUES ($1,$2,$3,now())`, [unsharedId, clientId, UNSHARED]);
  await sql(`INSERT INTO "Milestone" ("id","projectId","title","billableCents","updatedAt") VALUES ($1,$2,'Launch plan',55555,now())`, [newId(), projectId]);
  await sql(`INSERT INTO "Milestone" ("id","projectId","title","updatedAt") VALUES ($1,$2,'Internal milestone',now())`, [newId(), projectId]);
  await sql(`INSERT INTO "Task" ("id","projectId","title","description","updatedAt") VALUES ($1,$2,'Visible task','Shown to the client',now())`, [newId(), projectId]);
  await sql(`INSERT INTO "Task" ("id","projectId","title","updatedAt") VALUES ($1,$2,'Hidden task',now())`, [newId(), projectId]);
  await sql(`INSERT INTO "ProjectMember" ("projectId","userId") SELECT $1, "id" FROM "User" WHERE "email"='staff@rokket.test'`, [projectId]);
  const [casey] = await sql<{ id: string; clientId: string | null }>(`SELECT "id","clientId" FROM "User" WHERE "email"='client@rokket.test'`);
  caseyBefore = casey.clientId;
  await sql(`UPDATE "User" SET "clientId"=$1 WHERE "id"=$2`, [clientId, casey.id]);
});

test.afterAll(async () => {
  const [casey] = await sql<{ id: string }>(`SELECT "id" FROM "User" WHERE "email"='client@rokket.test'`);
  await sql(`UPDATE "User" SET "clientId"=$1 WHERE "id"=$2`, [caseyBefore, casey.id]);
  await sql(`DELETE FROM "Session" WHERE "userId"=$1`, [casey.id]);
  await sql(`DELETE FROM "Payment" WHERE "invoiceId" IN (SELECT "id" FROM "Invoice" WHERE "clientId"=$1)`, [clientId]);
  await sql(`DELETE FROM "Invoice" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "Quote" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "AuditLog" WHERE ("actorId"=$1 AND "action" LIKE 'quote.%') OR "entityId" IN ($2,$3)`, [casey.id, projectId, unsharedId]);
  await sql(`DELETE FROM "Activity" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "Project" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "Client" WHERE "id"=$1`, [clientId]);
  await closeDb();
});

// ---------------------------------------------------------------- empty state
test("client sees no projects until an admin shares one", async ({ page }) => {
  await login(page, "client@rokket.test");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Projects" }).click();
  await expect(page.getByText("No projects have been shared with you yet.")).toBeVisible();
  expect((await page.goto(`/portal/projects/${projectId}`))!.status()).toBe(404);
});

// ---------------------------------------------------------------- quotes and invoices
test("admin sends a quote and an invoice to the client", async ({ page }) => {
  await login(page, "admin@rokket.test");

  await page.goto("/quotes/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: CLIENT });
  await page.getByLabel("Title").fill("Portal quote");
  await page.getByLabel("Line 1 description").fill(QUOTE_LINE);
  await page.getByLabel("Line 1 unit price").fill("500");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Send quote" }).click();
  await page.getByRole("button", { name: "Yes, send" }).click();
  await expect(page.getByText(/Emailed to /)).toBeVisible();

  await page.goto("/invoices/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: CLIENT });
  await page.getByLabel("Line 1 description").fill(INVOICE_LINE);
  await page.getByLabel("Line 1 unit price").fill("100");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByRole("button", { name: "Yes, send" }).click();
  await expect(page.getByText(/Emailed to /)).toBeVisible();
});

test("client: overview, accept the quote, view and download the invoice, start paying", async ({ page }) => {
  await login(page, "client@rokket.test");
  await expect(page).toHaveURL(/\/portal/);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Overview", "Projects", "Quotes", "Invoices"]);
  await expect(page.getByText("$100.00").first()).toBeVisible(); // balance due
  await expect(page.getByText("Waiting for your answer")).toBeVisible();

  await nav.getByRole("link", { name: "Quotes" }).click();
  await page.getByRole("link", { name: /^Q-\d{4}$/ }).first().click();
  await expect(page.getByText(QUOTE_LINE)).toBeVisible();
  const qid = page.url().split("/").pop()!.split("?")[0];
  const qpdf = await page.request.get(`/api/portal/quotes/${qid}/pdf`);
  expect(qpdf.headers()["content-type"]).toBe("application/pdf");
  expect((await qpdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("button", { name: "Accept quote" }).click();
  await page.getByRole("button", { name: "Yes, accept" }).click();
  await expect(page.getByText("You accepted this quote.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept quote" })).toHaveCount(0);

  await nav.getByRole("link", { name: "Invoices" }).click();
  await page.getByRole("link", { name: /^INV-\d{4}$/ }).first().click();
  await expect(page.getByText(INVOICE_LINE)).toBeVisible();
  const iid = page.url().split("/").pop()!.split("?")[0];
  const ipdf = await page.request.get(`/api/portal/invoices/${iid}/pdf`);
  expect(ipdf.headers()["content-type"]).toBe("application/pdf");
  if (process.env.STRIPE_SECRET_KEY) {
    await page.getByRole("button", { name: /^Pay \$/ }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { waitUntil: "commit", timeout: 30_000 });
  }
});

test("client cannot reach other clients' documents or any admin page", async ({ page }) => {
  const [foreignInvoice] = await sql<{ id: string }>(`SELECT "id" FROM "Invoice" WHERE "clientId"<>$1 AND "status"<>'DRAFT' LIMIT 1`, [clientId]);
  const [foreignQuote] = await sql<{ id: string }>(`SELECT "id" FROM "Quote" WHERE "clientId"<>$1 AND "status"<>'DRAFT' LIMIT 1`, [clientId]);
  const draftId = newId();
  await sql(
    `INSERT INTO "Invoice" ("id","clientId","totalCents","subtotalCents","publicToken","updatedAt") VALUES ($1,$2,100,100,$3,now())`,
    [draftId, clientId, newToken()],
  );
  await login(page, "client@rokket.test");
  for (const [kind, row] of [["invoices", foreignInvoice], ["quotes", foreignQuote]] as const) {
    if (!row) continue;
    expect((await page.request.get(`/api/portal/${kind}/${row.id}/pdf`)).status()).toBe(404);
    expect((await page.goto(`/portal/${kind}/${row.id}`))!.status()).toBe(404);
  }
  expect((await page.request.get(`/api/portal/invoices/${draftId}/pdf`)).status()).toBe(404); // own draft is hidden too
  for (const path of ["/invoices", "/quotes", "/invoices/new", `/invoices/${draftId}`, "/settings", "/clients"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal/);
  }
  expect((await page.request.get(`/api/invoices/${draftId}/pdf`, { maxRedirects: 0 })).status()).toBe(403); // admin PDF route
});

test("admin sees the client's acceptance", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await page.goto(`/clients/${clientId}?tab=timeline`);
  await expect(page.getByText(/accepted by .* in the portal/)).toBeVisible();
  await page.goto("/quotes");
  await expect(page.getByRole("row").filter({ hasText: CLIENT }).getByText("Accepted")).toBeVisible();
});

// ---------------------------------------------------------------- project sharing
test("admin shares the project, one milestone and one task", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await page.goto(`/projects/${projectId}?tab=portal`);
  await expect(page.getByText("Not visible to client")).toBeVisible();
  await page.getByRole("button", { name: "Share this project with the client" }).click();
  await expect(page.getByText("Visible to client", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Share Launch plan with the client" }).click();
  await expect(page.getByRole("button", { name: "Hide Launch plan from the client" })).toBeVisible();
  await page.getByRole("button", { name: "Share Visible task with the client" }).click();
  await expect(page.getByRole("button", { name: "Hide Visible task from the client" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share Hidden task with the client" })).toBeVisible(); // still hidden
  await expect(page.getByText("Shared with client")).toBeVisible(); // header badge
});

test("client sees only what was shared, and nothing financial", async ({ page }) => {
  await login(page, "client@rokket.test");
  await page.goto("/portal/projects");
  await expect(page.getByText(PROJECT)).toBeVisible();
  await expect(page.getByText(UNSHARED)).toHaveCount(0);
  await page.getByRole("link", { name: new RegExp(PROJECT) }).click();
  await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible();
  await expect(page.getByText("Visible description")).toBeVisible();
  await expect(page.getByText("Launch plan")).toBeVisible();
  await expect(page.getByText("Visible task")).toBeVisible();
  await expect(page.getByText("Shown to the client")).toBeVisible();
  const body = await page.locator("body").innerText();
  for (const hidden of ["Hidden task", "Internal milestone", "6,543", "654321", "98765", "55555", "555.55"]) {
    expect(body).not.toContain(hidden);
  }
  expect((await page.goto(`/portal/projects/${unsharedId}`))!.status()).toBe(404);
});

test("admin hides the project and the client loses access immediately", async ({ page, browser }) => {
  await login(page, "admin@rokket.test");
  await page.goto(`/projects/${projectId}?tab=portal`);
  await page.getByRole("button", { name: "Hide this project from the client" }).click();
  await expect(page.getByText("Not visible to client")).toBeVisible();
  const ctx = await browser.newContext();
  const cp = await ctx.newPage();
  await login(cp, "client@rokket.test");
  expect((await cp.goto(`/portal/projects/${projectId}`))!.status()).toBe(404);
  await ctx.close();
});

test("staff on the project can open it but get no client portal tab", async ({ page }) => {
  await login(page, "staff@rokket.test");
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible(); // a real member, not a 404
  await expect(page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Client portal" })).toHaveCount(0);
  await page.goto(`/projects/${projectId}?tab=portal`);
  await expect(page.getByRole("button", { name: /Share .* with the client/ })).toHaveCount(0); // falls back to the overview
});
