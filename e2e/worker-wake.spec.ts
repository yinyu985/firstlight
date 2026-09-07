import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GIST_DESCRIPTION } from "../src/shared/model";

test("a bookmark event wakes a stopped worker and schedules its upload", async () => {
  const extensionPath = resolve(import.meta.dirname, "../dist/extension");
  const profile = await mkdtemp(join(tmpdir(), "firstlight-worker-wake-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  let content: string | undefined;
  await context.route("https://api.github.com/**", async (route) => {
    const method = route.request().method();
    if (method === "POST" || method === "PATCH") content = route.request().postDataJSON().files["firstlight.json"].content;
    const gist = {
      id: "wake-fixture",
      public: false,
      description: GIST_DESCRIPTION,
      html_url: "https://gist.github.com/wake-fixture",
      updated_at: "2026-09-07T02:00:00Z",
      files: { "firstlight.json": { content } }
    };
    await route.fulfill({ json: method === "GET" && new URL(route.request().url()).pathname === "/gists" ? (content ? [gist] : []) : gist });
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html`);
    const connected = await page.evaluate(() => chrome.runtime.sendMessage({ type: "SAVE_TOKEN", token: "worker-wake-test-token", rememberToken: true }));
    expect(connected.ok).toBe(true);
    await worker.evaluate(() => Object.assign(globalThis, { firstlightWakeProbe: true }));
    const session = await context.newCDPSession(page);
    const targets = await session.send("Target.getTargets");
    const target = targets.targetInfos.find((info) => info.type === "service_worker" && info.url === worker.url());
    expect(target).toBeDefined();
    await session.send("Target.closeTarget", { targetId: target!.targetId });
    await expect.poll(async () => (await session.send("Target.getTargets")).targetInfos.some((info) => info.targetId === target!.targetId)).toBe(false);
    await page.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      await chrome.bookmarks.create({ parentId: tree[0].children![0].id, title: "Created while worker was stopped", url: "https://example.test/wake" });
    });
    await expect.poll(async () => (await session.send("Target.getTargets")).targetInfos.some((info) => info.type === "service_worker")).toBe(true);
    // Chromium can reuse the target ID; the old JS global must be gone.
    expect(await worker.evaluate(() => "firstlightWakeProbe" in globalThis)).toBe(false);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const stored = await chrome.storage.local.get("firstlight");
          return Boolean(stored.firstlight.pendingUpload);
        })
      )
      .toBe(true);
    await session.detach();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
