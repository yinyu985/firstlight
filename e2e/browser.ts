import { chromium } from "@playwright/test";

/**
 * CI reuses the Google Chrome that GitHub runners ship instead of downloading
 * Playwright's bundled build on every run; local runs keep the bundled Chromium.
 */
export function launchExtensionContext(userDataDir: string, extensionPath: string) {
  return chromium.launchPersistentContext(userDataDir, {
    channel: process.env.CI ? "chrome" : "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
}
