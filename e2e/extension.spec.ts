import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("starts the extension app", async () => {
  const extensionPath = resolve(import.meta.dirname, "../dist/extension");
  const userDataDir = await mkdtemp(join(tmpdir(), "firstlight-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto(`chrome-extension://${extensionId}/newtab.html`);

    await expect(page).toHaveTitle("Firstlight");
    await expect(page.getByRole("textbox", { name: "Search bookmarks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
