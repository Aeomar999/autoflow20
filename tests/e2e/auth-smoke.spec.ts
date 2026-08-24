import { expect, test } from "@playwright/test";

test.skip(
  !process.env.E2E_SERVER && !process.env.E2E_BASE_URL,
  "E2E requires a provisioned server (set E2E_SERVER=1 or E2E_BASE_URL)",
);

test("unauthenticated visit to /workflows redirects to login", async ({
  page,
}) => {
  await page.goto("/workflows");
  await expect(page).toHaveURL(/\/(login|sign-in)/);
});

test("login page renders the auth form", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: /log ?in|sign ?in/i }),
  ).toBeVisible();
});
