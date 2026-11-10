import { expect, test, type Page } from "@playwright/test";
import { closeDb, newId, newToken, sql } from "./helpers/db";

const PASSWORD = process.env.SEED_PASSWORD ?? "";
const NAME = `E2E Portal Docs ${Date.now()}`;
const QUOTE_LINE = `Quote work ${Date.now()}`;
const INVOICE_LINE = `Invoice work ${Date.now()}`;
let clientId = "";
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
  clientId = newId();
  await sql(
    `INSERT INTO "Client" ("id","name","billingEmail","taxRateBps","updatedAt") VALUES ($1,$2,$3,0,now())`,
    [clientId, NAME, "ap@e2e-portal.test"],
  );
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
  await sql(`DELETE FROM "AuditLog" WHERE "actorId"=$1 AND "action" LIKE 'quote.%'`, [casey.id]);
  await sql(`DELETE FROM "Activity" WHERE "clientId"=$1`, [clientId]);
  await sql(`DELETE FROM "Client" WHERE "id"=$1`, [clientId]);
  await closeDb();
});

test("admin sends a quote and an invoice to the client", async ({ page }) => {
  await login(page, "admin@rokket.test");

  await page.goto("/quotes/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: NAME });
  await page.getByLabel("Title").fill("Portal quote");
  await page.getByLabel("Line 1 description").fill(QUOTE_LINE);
  await page.getByLabel("Line 1 unit price").fill("500");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Send quote" }).click();
  await page.getByRole("button", { name: "Yes, send" }).click();
  await expect(page.getByText(/Emailed to /)).toBeVisible();

  await page.goto("/invoices/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: NAME });
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
  await expect(nav.getByRole("link")).toHaveText(["Overview", "Quotes", "Invoices"]);
  await expect(page.getByText("$100.00").first()).toBeVisible(); // balance due
  await expect(page.getByText("Waiting for your answer")).toBeVisible();

  // quote: view, PDF, accept
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

  // invoice: view, PDF, pay
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
  await expect(page.getByRole("row").filter({ hasText: NAME }).getByText("Accepted")).toBeVisible();
});
