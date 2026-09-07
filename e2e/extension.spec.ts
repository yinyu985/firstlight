import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sampleSnapshot } from "./fixtures";
import { GIST_DESCRIPTION, type Snapshot } from "../src/shared/model";

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
    await expect(page.getByRole("dialog", { name: "FIRSTLIGHT" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Search bookmarks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible();

    await page.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      await chrome.bookmarks.create({ parentId: tree[0].children![0].id, title: "Regression bookmark", url: "https://example.test/regression" });
    });
    await expect(page.getByRole("button", { name: "Regression bookmark", exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("button", { name: "Search text position" }).click();
    await page.getByRole("option", { name: "HIDE", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "Search bookmarks" }).fill("Regression");
    await expect(page.locator(".search-row")).toHaveText("Regression bookmark");
    await page.getByRole("button", { name: "Clear search" }).click();

    await page.getByRole("button", { name: "Open note panel" }).click();
    await page.getByRole("button", { name: "Create new note" }).click();
    await page.getByRole("textbox", { name: "Note title" }).fill("Persistent note");
    await page.getByRole("textbox", { name: "Note content" }).fill("Last keystrokes survive closing");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
          return response.state.notes[0]?.content;
        })
      )
      .toBe("Last keystrokes survive closing");
    await page.reload();
    await page.getByRole("button", { name: "Open note panel" }).click();
    await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("Last keystrokes survive closing");
    await page.keyboard.press("Escape");

    await page.evaluate(async () => {
      const response = (await chrome.runtime.sendMessage({ type: "GET_STATE" })) as {
        state: { settings: Record<string, unknown> };
      };
      await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: {
          ...response.state.settings,
          background: {
            type: "dynamic",
            effect: "neuroNoise",
            speed: 1,
            parameters: {
              colorFront: "#f4f4f4",
              colorMid: "#248cff",
              colorBack: "#010409",
              brightness: 0.05,
              scale: 1,
              rotation: 0
            }
          }
        }
      });
    });
    await expect(page.locator(".dynamic-background canvas")).toBeVisible();

    await page.reload();
    await expect(page.locator(".app")).toBeVisible();
    await expect(page.locator(".dynamic-background canvas")).toBeVisible();
    expect(await page.locator(".dynamic-background canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("real extension diff restores remote data and uploads a reviewed local change", async () => {
  const extensionPath = resolve(import.meta.dirname, "../dist/extension");
  const userDataDir = await mkdtemp(join(tmpdir(), "firstlight-sync-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  let snapshot = sampleSnapshot();
  let uploads = 0;
  await context.route("https://api.github.com/**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer firstlight-e2e-token");
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { files: { "firstlight.json": { content: string } } };
      snapshot = JSON.parse(body.files["firstlight.json"].content) as Snapshot;
      uploads += 1;
    }
    const gist = {
      id: "fixture-gist",
      public: false,
      description: GIST_DESCRIPTION,
      html_url: "https://gist.github.com/fixture-gist",
      updated_at: "2026-08-03T02:00:00Z",
      files: { "firstlight.json": { content: JSON.stringify(snapshot) } }
    };
    await route.fulfill({ json: new URL(route.request().url()).pathname === "/gists" ? [gist] : gist });
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html`);
    await page.getByRole("textbox", { name: "GitHub token" }).fill("firstlight-e2e-token");
    await page.getByRole("button", { name: "SAVE", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Snapshot comparison" })).toBeVisible();
    await expect(page.locator(".cm-mergeView")).toBeVisible();
    await page.getByRole("button", { name: "USE REMOTE", exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
          return response.state.sync.message;
        })
      )
      .toBe("Restored remote snapshot");
    if (await page.getByRole("dialog", { name: "FIRSTLIGHT" }).count()) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open note panel" }).click();
    await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("Alpha");
    await page.keyboard.press("Escape");
    const tokenStored = await page.evaluate(async () => {
      const local = await chrome.storage.local.get("firstlight");
      const session = await chrome.storage.session.get("firstlight.token");
      return { local: Boolean(local.firstlight.token), session: Boolean(session["firstlight.token"]) };
    });
    expect(tokenStored).toEqual({ local: false, session: true });
    await page.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      await chrome.bookmarks.create({ parentId: tree[0].children![0].id, title: "Local addition", url: "https://example.test/local" });
    });
    await expect(page.getByRole("button", { name: "Local addition", exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("button", { name: "DIFF", exact: true }).click();
    await expect(page.locator(".cm-mergeView")).toBeVisible();
    await page.getByRole("button", { name: "USE LOCAL", exact: true }).click();
    await expect.poll(() => uploads).toBe(1);
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
          return response.state.sync.message;
        })
      )
      .toBe("Uploaded to remote");
    expect(snapshot.bookmarks.some((item) => item.title === "Local addition")).toBe(true);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
