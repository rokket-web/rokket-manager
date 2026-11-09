import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "";
const NAME = `E2E Co ${Date.now()}`;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)/);
}

test.describe.configure({ mode: "serial" });

test("admin: create, search, contact, note, status, edit, export, delete", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await page.goto("/clients/new");
  await page.getByLabel("Company name").fill(NAME);
  await page.getByLabel("Tax rate (%)").fill("8.25");
  await page.getByLabel("Tags").fill("e2e, Demo");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("8.25%")).toBeVisible();

  // contact
  await page.getByRole("link", { name: "Contacts" }).click();
  await page.getByLabel("First name").last().fill("Pat");
  await page.getByLabel("Last name").last().fill("Example");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Pat Example")).toBeVisible();
  await expect(page.getByText("Primary", { exact: true })).toBeVisible();

  // note
  await page.getByRole("link", { name: "Notes" }).click();
  await page.getByLabel("Add an internal note").fill("Called about the new site.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Called about the new site.")).toBeVisible();

  // status change + timeline
  await page.getByLabel("Change status").selectOption("ACTIVE");
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("link", { name: "Timeline" }).click();
  await expect(page.getByText("Status changed from lead to active")).toBeVisible();

  // list search + filters
  await page.goto("/clients?q=" + encodeURIComponent(NAME));
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();
  await page.goto("/clients?status=PAST&q=" + encodeURIComponent(NAME));
  await expect(page.getByText("No clients found.")).toBeVisible();

  // pipeline
  await page.goto("/clients/pipeline");
  await expect(page.getByRole("region", { name: "Active" }).getByText(NAME)).toBeVisible();

  // export contains the client
  const res = await page.request.get("/api/clients/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain(NAME);

  // edit then delete
  await page.goto("/clients?q=" + encodeURIComponent(NAME));
  await page.getByRole("link", { name: NAME }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Industry").fill("Testing");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.goto("/clients?q=" + encodeURIComponent(NAME));
  await expect(page.getByText("No clients found.")).toBeVisible();
});

test("admin: CSV import reports created, skipped and row errors", async ({ page }) => {
  const n = `E2E Import ${Date.now()}`;
  await login(page, "admin@rokket.test");
  await page.goto("/clients/import");
  await page.setInputFiles("#file", {
    name: "clients.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`name,status,email\n${n},lead,ok@example.com\n${n}2,lead,not-an-email\n`),
  });
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("status")).toContainText("1 created");
  await expect(page.getByRole("status")).toContainText("1 with errors");
  await expect(page.getByRole("status")).toContainText("Row 3");
  await page.goto("/clients?q=" + encodeURIComponent(n));
  await page.getByRole("link", { name: n, exact: true }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL(/\/clients$/);
});

test("staff: read-only, sees no unassigned clients, cannot write or export", async ({ page }) => {
  await login(page, "staff@rokket.test");
  await page.goto("/clients");
  await expect(page.getByText("No clients are assigned to you yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "New client" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  for (const path of ["/clients/new", "/clients/import"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard/);
  }
  expect((await page.request.get("/api/clients/export")).status()).toBe(403);
});

test("client portal user and anonymous visitors are blocked from clients", async ({ page, request }) => {
  await login(page, "client@rokket.test");
  for (const path of ["/clients", "/clients/pipeline", "/clients/new"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal/);
  }
  expect((await page.request.get("/api/clients/export")).status()).toBe(403);
  const anon = await request.get("/api/clients/export", { maxRedirects: 0 });
  expect([307, 401]).toContain(anon.status());
});
