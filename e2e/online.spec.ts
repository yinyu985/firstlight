import { expect, test } from "@playwright/test";
import { connectOnline, sampleSnapshot } from "./fixtures";

test("starts the online app", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page).toHaveTitle("Firstlight Online");
  await expect(page.getByRole("textbox", { name: "Search bookmarks" })).toBeVisible();
  await expect(page.getByText("Connect a GitHub token to read your snapshot")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("hiding search text or the icon leaves matching results usable", async ({ page }) => {
  await connectOnline(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Search text position" }).click();
  await page.getByRole("option", { name: "HIDE", exact: true }).click();
  await page.getByRole("group", { name: "Search icon", exact: true }).getByRole("button", { name: "HIDE" }).click();
  await page.keyboard.press("Escape");
  const search = page.getByRole("textbox", { name: "Search bookmarks" });
  await expect(search).toHaveAttribute("placeholder", "");
  await search.fill("Guide");
  const result = page.getByRole("button", { name: "Guide — Work", exact: true });
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("title", "Work / Guide");
  await search.fill("does-not-exist");
  await expect(page.getByText("NO RESULTS", { exact: true })).toBeVisible();
  await search.fill("Guide");
  await page.keyboard.press("Escape");
  await expect(result).toHaveCount(0);
  await search.blur();
  await search.focus();
  await expect(result).toBeVisible();
});

test("pickers support keyboard navigation and Escape closes the picker before the drawer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const trigger = page.getByRole("button", { name: "Search text position" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "LEFT", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "RIGHT", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("RIGHT");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("a failed account switch does not retain the previous account's bookmarks or Notes", async ({ page }) => {
  await connectOnline(page);
  await expect(page.getByRole("button", { name: "Work", exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("textbox", { name: "GitHub token" }).fill("different-invalid-token");
  await page.getByRole("button", { name: "SAVE", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Bad credentials");
  await page.keyboard.press("Escape");
  await expect(page.locator(".bookmark-cell")).toHaveCount(0);
  await page.getByRole("button", { name: "Open note panel" }).click();
  await expect(page.locator(".notes-item")).toHaveCount(0);
});

test("Notes sorting is available and Online remains read only", async ({ page }, testInfo) => {
  await connectOnline(page);
  await page.getByRole("button", { name: "Open note panel" }).click();
  await expect(page.locator(".notes-item-title").first()).toHaveText("Recently edited");
  await page.getByRole("button", { name: "Sort notes" }).click();
  await page.getByRole("option", { name: "CREATED", exact: true }).click();
  await expect(page.locator(".notes-item-title").first()).toHaveText("Recently created");
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Create new note" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("notes.png") });
});

test("large folder and Notes lists keep their last entry reachable", async ({ page }) => {
  const snapshot = sampleSnapshot();
  snapshot.bookmarks[0].children = Array.from({ length: 2_000 }, (_, i) => ({ title: `Nested ${i}`, url: `https://example.test/${i}` }));
  snapshot.notes = Array.from({ length: 2_000 }, (_, i) => ({
    ...snapshot.notes[0],
    id: `note-${i}`,
    name: `Note ${String(i).padStart(4, "0")}`,
    content: `Content ${i}`
  }));
  await connectOnline(page, snapshot);
  await page.getByRole("button", { name: "Work", exact: false }).click();
  await page.locator(".folder-row").first().focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Nested 1999", exact: true })).toBeFocused();
  expect(await page.locator(".folder-row").count()).toBeLessThan(200);
  await page.getByRole("button", { name: "Open note panel" }).click();
  await page.locator(".notes-item").first().focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Note 1999", exact: false })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("Content 1999");
  expect(await page.locator(".notes-item").count()).toBeLessThan(200);
});

test("Rows sets a minimum height without limiting bookmark capacity", async ({ page }) => {
  await connectOnline(page);
  const grid = page.locator(".bookmark-table");
  const before = await grid.boundingBox();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Home grid rows", exact: true }).click();
  await page.getByRole("option", { name: "8", exact: true }).click();
  await page.keyboard.press("Escape");
  const after = await grid.boundingBox();
  expect(after!.height).toBeGreaterThan(before!.height);
  await expect(page.getByRole("button", { name: "Work", exact: false })).toBeVisible();
});

test("the full-width settings drawer can be closed on a narrow touchscreen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search bookmarks" })).toBeVisible();
});

test("large root lists retain the last item without mounting the whole dataset", async ({ page }) => {
  const snapshot = sampleSnapshot();
  snapshot.bookmarks = Array.from({ length: 20_000 }, (_, i) => ({ title: `Bookmark ${i}`, url: `https://example.test/${i}` }));
  await connectOnline(page, snapshot);
  await expect(page.locator('[data-virtualized="true"]')).toBeVisible();
  expect(await page.locator(".bookmark-cell").count()).toBeLessThan(300);
  await page.locator(".bookmark-cell").first().focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Bookmark 19999", exact: false })).toBeFocused();
  expect(await page.locator(".bookmark-cell").count()).toBeLessThan(300);
});

test("Online sends a frame-ancestors policy and leaves optional backgrounds out of the initial requests", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.locator(".app")).toBeVisible();
  expect(scripts.some((url) => /\/(?:vendor-|NeuroNoise-)/.test(url))).toBe(false);
});

test("data bookmarks execute in an opaque-origin top-level page without inheriting the app's restrictive CSP", async ({ page, context }) => {
  const snapshot = sampleSnapshot();
  snapshot.bookmarks = [
    {
      title: "Sandbox demo",
      url:
        "data:text/html," +
        encodeURIComponent(
          '<!doctype html><h1>Loading</h1><script>let isolated=false;try{localStorage.getItem("firstlight.online.token")}catch(e){isolated=true}document.querySelector("h1").textContent=isolated?"Isolated bookmark running":"UNSAFE"</script>'
        )
    }
  ];
  await connectOnline(page, snapshot);
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Sandbox demo", exact: false }).click();
  const viewer = await opened;
  await expect(viewer).toHaveURL(/^blob:null\//);
  await expect(viewer.getByRole("heading", { name: "Isolated bookmark running" })).toBeVisible();
  await expect(viewer.locator("iframe")).toHaveCount(0);
});

test("a blocked data-bookmark navigation displays an error instead of a blank viewer", async ({ page, context }) => {
  const snapshot = sampleSnapshot();
  snapshot.bookmarks = [{ title: "Blocked demo", url: "data:text/html,Blocked" }];
  await context.route("**/data-viewer.html*", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("allow-scripts allow-top-navigation", "allow-scripts");
    await route.fulfill({ response, body });
  });
  await connectOnline(page, snapshot);
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Blocked demo", exact: false }).click();
  const viewer = await opened;
  await expect(viewer.locator('#data-bookmark-status[data-state="error"]')).toBeVisible();
  await expect(viewer).not.toHaveURL(/^blob:/);
});
