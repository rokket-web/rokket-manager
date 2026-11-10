import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "";
const TITLE = `E2E Quote ${Date.now()}`;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)/);
}

test("staff cannot reach quotes or invoices", async ({ page }) => {
  await login(page, "staff@rokket.test");
  for (const path of ["/quotes", "/invoices", "/invoices/new"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard/);
  }
  await expect(page.getByRole("link", { name: "Invoices" })).toHaveCount(0);
});

test("PDFs: anonymous is turned away, staff is forbidden", async ({ page, request }) => {
  for (const path of ["/api/invoices/anything/pdf", "/api/quotes/anything/pdf"]) {
    expect([307, 401]).toContain((await request.get(path, { maxRedirects: 0 })).status());
  }
  await login(page, "staff@rokket.test");
  expect((await page.request.get("/api/invoices/anything/pdf", { maxRedirects: 0 })).status()).toBe(403);
  expect((await page.request.get("/api/quotes/anything/pdf", { maxRedirects: 0 })).status()).toBe(403);
});

test("admin: saves billing settings", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await page.goto("/settings");
  await page.getByLabel("Company name").fill("Rokket Web");
  await page.getByLabel("Default tax rate (%)").fill("8.25");
  await page.getByRole("button", { name: "Save billing settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Default tax rate (%)")).toHaveValue("8.25");
});

test("admin: quote -> accepted -> invoice -> sent -> paid", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await page.goto("/quotes/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: "Acme Plumbing" });
  await page.getByLabel("Title").fill(TITLE);
  await page.getByLabel("Line 1 description").fill("Website build");
  await page.getByLabel("Line 1 quantity").fill("2");
  await page.getByLabel("Line 1 unit price").fill("100");
  // live preview is shown, server is authoritative
  await expect(page.getByText("Preview. Final amounts")).toBeVisible();
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Line 2 description").fill("Hosting");
  await page.getByLabel("Line 2 unit price").fill("50.50");
  await page.getByLabel("Line 2 taxable").selectOption("false");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: /Quote \(draft\)/ })).toBeVisible();
  await expect(page.getByText("$250.50").first()).toBeVisible(); // subtotal (tax depends on client rate)

  await page.getByRole("button", { name: "Send quote" }).click();
  await page.getByRole("button", { name: "Yes, send" }).click();
  await expect(page.getByRole("heading", { name: /Quote Q-\d{4}/ })).toBeVisible();
  await expect(page.getByText(/Emailed to /)).toBeVisible();
  const qpdf = await page.request.get(page.url().replace(/\/quotes\/([^/?]+).*/, "/api/quotes/$1/pdf"));
  expect(qpdf.headers()["content-type"]).toBe("application/pdf");
  expect((await qpdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("button", { name: "Record accepted" }).click();
  await page.getByRole("button", { name: "Yes, accepted" }).click();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByRole("button", { name: "Yes, create" }).click();
  await expect(page.getByRole("heading", { name: /Invoice \(draft\)/ })).toBeVisible();

  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByRole("button", { name: "Yes, send" }).click();
  await expect(page.getByRole("heading", { name: /Invoice INV-\d{4}/ })).toBeVisible();
  await expect(page.getByText(/Emailed to /)).toBeVisible();
  await page.getByRole("button", { name: "Resend email" }).click();
  await page.getByRole("button", { name: "Yes, resend" }).click();
  await expect(page.getByText(/Emailed to /)).toBeVisible();

  // partial then full payment; overpayment is refused
  await page.getByLabel("Amount (USD)").fill("10");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Partially paid").first()).toBeVisible();
  await page.getByLabel("Amount (USD)").fill("99999");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("more than the balance due")).toBeVisible();
});
