import { expect, test, type Page } from "@playwright/test";

// Requires seeded users (npm run db:seed) and SEED_PASSWORD in the environment.
const PASSWORD = process.env.SEED_PASSWORD ?? "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("health endpoint verifies the database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect((await res.json()).db).toBe("up");
});

test("anonymous users are sent to login", async ({ page }) => {
  for (const path of ["/dashboard", "/settings", "/settings/users", "/portal"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("admin sees full navigation and the users page", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await expect(page).toHaveURL(/\/dashboard/);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Users" })).toBeVisible();
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
});

test("staff has no Users link and is bounced from /settings/users", async ({ page }) => {
  await login(page, "staff@rokket.test");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Users" })).toHaveCount(0);
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("client only reaches the portal", async ({ page }) => {
  await login(page, "client@rokket.test");
  await expect(page).toHaveURL(/\/portal/);
  for (const path of ["/dashboard", "/settings", "/settings/users"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal/);
  }
});

test("bad credentials are rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@rokket.test");
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
