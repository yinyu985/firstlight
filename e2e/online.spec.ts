import { expect, test } from "@playwright/test";
import { connectOnline, sampleSnapshot } from "./fixtures";
import { expectFolderAttached, expectNotesMetadataVisible, expectNotesSortContained } from "./layoutAssertions";

for (const virtual of [false, true]) {
  test(`folder popovers attach without a gap in ${virtual ? "virtual" : "ordinary"} grids`, async ({ page }, testInfo) => {
    const snapshot = sampleSnapshot();
    if (virtual) {
      snapshot.bookmarks.push(...Array.from({ length: 600 }, (_, i) => ({ title: `Bookmark ${i}`, url: `https://example.test/${i}` })));
    }
    await connectOnline(page, snapshot);
    await page.getByRole("button", { name: "Work", exact: false }).click();
    await expectFolderAttached(page, "bottom");
    // A font/layout change must not reintroduce a gap while the panel is open.
    await page.locator(".app").evaluate((app) => (app as HTMLElement).style.setProperty("--ui-font-size", "20px"));
    await expectFolderAttached(page, "bottom");
    await page.setViewportSize({ width: 900, height: 700 });
    await expectFolderAttached(page, "bottom");
    if (virtual) {
      const anchor = page.locator(".bookmark-cell-wrap.active > .bookmark-cell");
      const before = (await anchor.boundingBox())!;
      await page.locator(".app").evaluate((app) => (app.scrollTop += 30));
      await expect.poll(async () => (await anchor.boundingBox())!.y).toBe(before.y - 30);
      await expectFolderAttached(page, "bottom");
    }
    await page.screenshot({ path: testInfo.outputPath("folder-attached.png") });
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`Notes metadata stays complete at the editor bottom in ${theme} mode`, async ({ page }, testInfo) => {
    const snapshot = sampleSnapshot();
    snapshot.config.features.themeMode = theme;
    snapshot.notes[0].content = "Metadata stays visible\n".repeat(500);
    await connectOnline(page, snapshot);
    await page.getByRole("button", { name: "Open note panel" }).click();
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1024, height: 768 }
    ]) {
      await page.setViewportSize(viewport);
      await expectNotesMetadataVisible(page);
      const footer = page.locator(".notes-statusbar");
      const before = await footer.boundingBox();
      await page.getByRole("textbox", { name: "Note content" }).evaluate((node) => (node.scrollTop = node.scrollHeight));
      expect(await footer.boundingBox()).toEqual(before);
      await expectNotesMetadataVisible(page);
      await page.screenshot({ path: testInfo.outputPath(`notes-metadata-${viewport.width}-${viewport.height}.png`) });
    }
    await page.getByRole("group", { name: "Sort notes" }).getByRole("button", { name: "CREATED", exact: true }).click();
    await page.locator(".notes-item").first().click();
    await expect(page.locator(".notes-meta")).toContainText("Created: 2026-08-02 10:00:00");
    await expectNotesMetadataVisible(page);
  });

  test(`Notes sort has its own bounded row in ${theme} mode`, async ({ page }, testInfo) => {
    const snapshot = sampleSnapshot();
    snapshot.config.features.themeMode = theme;
    await connectOnline(page, snapshot);
    await page.getByRole("button", { name: "Open note panel" }).click();
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      const control = page.getByRole("group", { name: "Sort notes" });
      const sidebar = page.locator(".notes-sidebar");
      const before = { control: await control.boundingBox(), sidebar: await sidebar.boundingBox() };
      await expectNotesSortContained(page);
      await page.screenshot({ path: testInfo.outputPath(`notes-sort-${width}.png`) });
      await control.getByRole("button", { name: "CREATED", exact: true }).click();
      expect(await control.boundingBox()).toEqual(before.control);
      expect(await sidebar.boundingBox()).toEqual(before.sidebar);
      await expect(page.locator(".notes-item-title").first()).toHaveText("Recently created");
      await expect(control.getByRole("button", { name: "CREATED", exact: true })).toHaveAttribute("aria-pressed", "true");
      await control.getByRole("button", { name: "MODIFIED", exact: true }).click();
    }
  });
}

test("light Notes keeps focused titles legible and light sliders remain neutral", async ({ page }, testInfo) => {
  const snapshot = sampleSnapshot();
  snapshot.config.features.themeMode = "light";
  snapshot.config.features.themeColor = "#ffffaa";
  await connectOnline(page, snapshot);
  await page.getByRole("button", { name: "Open note panel" }).click();
  const title = page.getByRole("textbox", { name: "Note title" });
  const color = await title.evaluate((node) => getComputedStyle(node).color);
  await title.focus();
  expect(await title.evaluate((node) => getComputedStyle(node).color)).toBe(color);
  expect(color).not.toBe("rgb(245, 245, 245)");
  expect(await page.locator(".notes-item-wrap.is-active .notes-item-title").evaluate((node) => getComputedStyle(node).color)).toBe("rgb(23, 26, 24)");
  await page.screenshot({ path: testInfo.outputPath("light-notes-focus.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.screenshot({ path: testInfo.outputPath("light-sliders.png") });
});

test("closing settings preserves the expanded folder navigation", async ({ page }) => {
  await connectOnline(page);
  await page.getByRole("button", { name: "Work", exact: false }).click();
  await expect(page.locator(".folder-popover")).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Guide", exact: true })).toBeVisible();
});

test("End skips a non-openable virtual-list tail without losing focus", async ({ page }) => {
  const snapshot = sampleSnapshot();
  snapshot.bookmarks = Array.from({ length: 1000 }, (_, i) => ({ title: `Bookmark ${i}`, url: `https://example.test/${i}` }));
  snapshot.bookmarks[999].url = "javascript:void(0)";
  await connectOnline(page, snapshot);
  await page.locator(".bookmark-cell").first().focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Bookmark 998", exact: false })).toBeFocused();
});

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
  await page.getByRole("group", { name: "Sort notes" }).getByRole("button", { name: "CREATED", exact: true }).click();
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
  expect(scripts.some((url) => /\/(?:vendor-|NeuroNoise-|NotesApp-)/.test(url))).toBe(false);
  await page.getByRole("button", { name: "Open note panel" }).click();
  await expect(page.locator("#notes-app")).toBeVisible();
  expect(scripts.some((url) => /\/NotesApp-/.test(url))).toBe(true);
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
