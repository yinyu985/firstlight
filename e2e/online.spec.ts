import { expect, test } from "@playwright/test";

test("starts the online app", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page).toHaveTitle("Firstlight Online");
  await expect(page.getByRole("textbox", { name: "Search bookmarks" })).toBeVisible();
  await expect(page.getByText("BOOKMARK BAR IS EMPTY")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
