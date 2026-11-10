import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "";
const NAME = `E2E Portal Client ${Date.now()}`;
const EMAIL = `e2e-portal-${Date.now()}@example.test`;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)/);
}

test("admin: invite, resend, turn off and restore portal access, then delete the client", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await page.goto("/clients/new");
  await page.getByLabel("Company name").fill(NAME);
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  await page.getByRole("navigation", { name: "Client sections" }).getByRole("link", { name: "Portal access" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Pat Portal");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(EMAIL)).toBeVisible();
  await expect(page.getByText("Access is on.")).toBeVisible();

  await page.getByRole("button", { name: "Resend invite" }).click();
  await page.getByRole("button", { name: "Yes, send" }).click();
  await expect(page.getByText("Invite email sent.")).toBeVisible();

  await page.getByRole("button", { name: "Turn off access" }).click();
  await page.getByRole("button", { name: "Yes, turn off" }).click();
  await expect(page.getByText("Access is turned off.")).toBeVisible();
  await page.getByRole("button", { name: "Restore access" }).click();
  await page.getByRole("button", { name: "Yes, restore" }).click();
  await expect(page.getByText("Access is on.")).toBeVisible();

  // billing tab replaced the old "arrives in Phase 4" placeholder
  await page.getByRole("navigation", { name: "Client sections" }).getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByText("arrive in Phase 4")).toHaveCount(0);

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL(/\/clients$/);
});
