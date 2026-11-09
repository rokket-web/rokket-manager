import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_PASSWORD ?? "";
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name, exact: true });
const NAME = `E2E Project ${Date.now()}`;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)/);
}

test.describe.configure({ mode: "serial" });

test("admin: project, milestone, task, board, time and rollups", async ({ page }) => {
  await login(page, "admin@rokket.test");
  await page.goto("/projects/new");
  await page.getByLabel("Client").selectOption({ label: "Acme Plumbing" });
  await page.getByLabel("Project name").fill(NAME);
  await page.getByLabel("Status").selectOption("ACTIVE");
  await page.getByLabel("Budget (USD)").fill("1000");
  await page.getByLabel("Hourly rate (USD)").fill("100");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  // team: add staff
  await tab(page, "Team").click();
  await page.getByLabel(/Sam Staff/).check();
  await page.getByLabel(/Josh Admin/).check();
  await page.getByRole("button", { name: "Save team" }).click();

  // milestone
  await tab(page, "Milestones").click();
  await page.getByLabel("Milestone", { exact: true }).last().fill("Launch");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByText("Launch").first()).toBeVisible();

  // task (list view), then board move
  await tab(page, "Tasks").click();
  await page.getByLabel("Task", { exact: true }).fill("Build homepage");
  await page.getByLabel("Assignee").selectOption({ label: "Sam Staff" });
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("link", { name: "Build homepage" })).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  const todo = page.getByRole("region", { name: "To do" });
  await expect(todo.getByText("Build homepage")).toBeVisible();
  await todo.getByLabel("Move Build homepage").selectOption("DONE");
  await todo.getByRole("button", { name: "Move" }).click();
  await expect(page.getByRole("region", { name: "Done" }).getByText("Build homepage")).toBeVisible();

  // comment on the task
  await page.getByRole("link", { name: "Build homepage" }).click();
  await page.getByLabel("Add a comment").fill("Looks good");
  await page.getByRole("button", { name: "Comment" }).click();
  await expect(page.getByText("Looks good")).toBeVisible();

  // manual time on /time
  await page.goto("/time");
  await page.getByText("Add a manual entry").click();
  await page
    .getByLabel("Project")
    .last()
    .selectOption({ label: `${NAME} (Acme Plumbing)` });
  await page.getByLabel("Hours").fill("1");
  await page.getByLabel("Minutes").fill("30");
  await page.getByRole("button", { name: "Add entry" }).click();
  // The form section collapses on refresh, so assert on the new row in the entries table.
  await expect(page.getByRole("row", { name: new RegExp(`${NAME}.*1h 30m`) })).toBeVisible();

  // timer start / stop
  await page
    .getByLabel("Project")
    .first()
    .selectOption({ label: `${NAME} (Acme Plumbing)` });
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();
  await page.getByRole("button", { name: "Stop timer" }).click();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();

  // rollups on the dashboard: 100% progress, 1 task, 1h 30m + timer minute(s), billable value shown to admin
  await page.goto("/projects?q=" + encodeURIComponent(NAME));
  await page.getByRole("link", { name: NAME }).click();
  await expect(page.getByText("100%")).toBeVisible();
  await expect(page.getByText("1/1 tasks")).toBeVisible();
  await expect(page.getByText(/^1h 3\dm$/).first()).toBeVisible();
  await expect(page.getByText("Billable value")).toBeVisible();

  // delete project
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("staff: sees assigned projects only, no money, cannot manage", async ({ page }) => {
  await login(page, "staff@rokket.test");
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Website redesign" })).toBeVisible();
  await expect(page.getByRole("link", { name: "SEO retainer" })).toHaveCount(0); // not assigned
  await expect(page.getByRole("columnheader", { name: "Budget" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
  await page.goto("/projects/new");
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/projects");
  await page.getByRole("link", { name: "Website redesign" }).click();
  await expect(page.getByText("Billable value")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // staff can reach the client record only because of the assignment
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "Acme Plumbing" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cedar Ridge Dental" })).toHaveCount(0);
});

test("staff: an unassigned project is a 404, and the client portal user is blocked", async ({ page, browser }) => {
  const admin = await browser.newPage();
  await login(admin, "admin@rokket.test");
  await admin.goto("/projects?q=SEO");
  const href = await admin.getByRole("link", { name: "SEO retainer" }).getAttribute("href");
  await admin.close();

  await login(page, "staff@rokket.test");
  const res = await page.goto(href!);
  expect(res?.status()).toBe(404);

  await page.context().clearCookies();
  await login(page, "client@rokket.test");
  for (const path of ["/projects", "/time", href!]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal/);
  }
  expect((await page.request.get("/api/files/does-not-exist")).status()).toBe(403);
});

test("files API: anonymous is redirected, unknown ids are 404 for staff", async ({ page, request }) => {
  const anon = await request.get("/api/files/x", { maxRedirects: 0 });
  expect([307, 401]).toContain(anon.status());
  await login(page, "staff@rokket.test");
  const res = await page.request.get("/api/files/does-not-exist", { maxRedirects: 0 });
  expect([404, 503]).toContain(res.status());
});

// Real browser upload to the bucket (exercises signed URLs + CORS). Skipped where no bucket is configured (e.g. CI).
test("files: browser upload, download redirect and delete via the real bucket", async ({ page }) => {
  test.skip(!process.env.GCS_BUCKET || !process.env.GOOGLE_SERVICE_ACCOUNT_FILE, "GCS not configured");
  const fileName = `e2e-upload-${Date.now()}.txt`;
  await login(page, "admin@rokket.test");
  await page.goto("/projects?q=Website%20redesign");
  await page.getByRole("link", { name: "Website redesign" }).click();
  await page
    .getByRole("navigation", { name: "Project sections" })
    .getByRole("link", { name: "Files", exact: true })
    .click();
  await page.setInputFiles("#upload-file", {
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("hello from e2e"),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const link = page.getByRole("link", { name: fileName });
  await expect(link).toBeVisible({ timeout: 20_000 });

  // Authorized download redirects to a short-lived signed URL, which serves the file as an attachment.
  const href = await link.getAttribute("href");
  const redirect = await page.request.get(href!, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const signed = redirect.headers()["location"];
  expect(signed).toContain("X-Goog-Signature");
  const file = await page.request.get(signed);
  expect(file.status()).toBe(200);
  expect(await file.text()).toBe("hello from e2e");
  expect(file.headers()["content-disposition"]).toContain("attachment");

  // Delete removes it.
  // Scope to the file's own row: the project header also has a Delete button that must never be clicked here.
  const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: fileName }) });
  await row.getByRole("button", { name: "Delete" }).click();
  await row.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByRole("link", { name: fileName })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Website redesign" })).toBeVisible(); // the project itself is untouched
});
