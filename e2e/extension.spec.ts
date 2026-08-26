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

    await page.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" }) as {
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

    await page.addInitScript(() => {
      const sampledWindow = window as typeof window & {
        __firstlightFrames?: Array<{ app: boolean; canvas: boolean; canvasWidth: number }>;
      };
      sampledWindow.__firstlightFrames = [];
      const sample = () => {
        const canvas = document.querySelector<HTMLCanvasElement>(".dynamic-background canvas");
        sampledWindow.__firstlightFrames?.push({
          app: Boolean(document.querySelector(".app")),
          canvas: Boolean(canvas),
          canvasWidth: canvas?.width ?? 0
        });
        if ((sampledWindow.__firstlightFrames?.length ?? 0) < 60) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await expect(page.locator(".dynamic-background canvas")).toBeVisible();
    await page.waitForFunction(() => (
      (window as typeof window & { __firstlightFrames?: unknown[] }).__firstlightFrames?.length ?? 0
    ) >= 10);
    const frames = await page.evaluate(() => (
      window as typeof window & {
        __firstlightFrames?: Array<{ app: boolean; canvas: boolean; canvasWidth: number }>;
      }
    ).__firstlightFrames ?? []);
    const firstAppFrame = frames.find((frame) => frame.app);
    expect(firstAppFrame).toMatchObject({ canvas: true });
    expect(firstAppFrame?.canvasWidth).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
