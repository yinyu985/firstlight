import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GIST_DESCRIPTION, type SyncNote } from "../src/shared/model";
import { decodeGistSnapshot } from "../src/shared/notesEnvelope";
import type { ExtensionRequest, ExtensionResponse } from "../src/shared/protocol";

const request = (page: Page, message: ExtensionRequest): Promise<ExtensionResponse> => page.evaluate((message) => chrome.runtime.sendMessage(message), message);

test("large Notes survive extension A → independent extension B → Online, failed rekey and Worker restart", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const profiles: string[] = [],
    contexts: BrowserContext[] = [];
  let content: string | undefined;
  let writes = 0;
  let dropWriteResponse = false;
  let failReads = false;
  const token = "firstlight-cross-device-test",
    replacement = "firstlight-replacement-test";
  const gist = () => ({
    id: "encrypted-fixture",
    owner: { id: 1 },
    public: false,
    description: GIST_DESCRIPTION,
    html_url: "https://gist.github.com/encrypted-fixture",
    updated_at: `2026-09-07T02:00:${String(writes).padStart(2, "0")}Z`,
    files: { "firstlight.json": { content } }
  });
  const launch = async () => {
    const profile = await mkdtemp(join(tmpdir(), "firstlight-crypto-"));
    profiles.push(profile);
    const path = resolve(import.meta.dirname, "../dist/extension");
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`]
    });
    contexts.push(context);
    await context.route("https://api.github.com/**", async (route) => {
      const method = route.request().method(),
        pathname = new URL(route.request().url()).pathname;
      if (method === "POST" || method === "PATCH") {
        content = route.request().postDataJSON().files["firstlight.json"].content;
        writes++;
        if (dropWriteResponse) {
          await route.abort("failed");
          return;
        }
      }
      if (failReads && method === "GET") {
        await route.abort("failed");
        return;
      }
      await route.fulfill({ json: pathname === "/user" ? { id: 1 } : pathname === "/gists" && method === "GET" ? (content ? [gist()] : []) : gist() });
    });
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html`);
    await expect(page.locator(".app")).toBeVisible();
    return { context, page, worker };
  };
  try {
    const a = await launch();
    const notes: SyncNote[] = [
      {
        id: "cross-device",
        name: "Visible title 中文🔎",
        content: "Private body 中文🙂\r\n\tNo truncation or rewriting.\n".repeat(24_000),
        createtime: "2026-09-07T10:00:00.000+08:00",
        updatetime: "2026-09-07T11:00:00.000+08:00"
      }
    ];
    expect((await request(a.page, { type: "SAVE_NOTES", notes })).ok).toBe(true);
    const start = performance.now();
    const created = await request(a.page, { type: "SAVE_TOKEN", token, rememberToken: true });
    const uploadMs = performance.now() - start;
    expect(created.ok, created.error).toBe(true);
    expect(writes).toBe(1);
    expect(JSON.parse(content!).notes.items[0].name).toBe(notes[0].name);
    expect(content).not.toContain("Private body");
    expect((await decodeGistSnapshot(content!, token)).snapshot.notes).toEqual(notes);

    const b = await launch();
    const readStart = performance.now();
    const connected = await request(b.page, { type: "SAVE_TOKEN", token });
    expect(connected.ok, connected.error).toBe(true);
    expect(connected.state?.diff?.right.notes).toEqual(notes);
    const readMs = performance.now() - readStart;
    const restored = await request(b.page, { type: "USE_REMOTE", diffId: connected.state!.diff!.id });
    expect(restored.ok, restored.error).toBe(true);
    expect(restored.state?.notes).toEqual(notes);
    expect(writes).toBe(1);

    const onlineContext = await browser.newContext();
    contexts.push(onlineContext);
    const online = await onlineContext.newPage();
    await online.route("https://api.github.com/**", async (route) => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({ json: new URL(route.request().url()).pathname === "/gists" ? [gist()] : gist() });
    });
    await online.goto("/");
    await online.getByRole("button", { name: "Open settings" }).click();
    await online.getByRole("textbox", { name: "GitHub token" }).fill(token);
    await online.getByRole("button", { name: "SAVE", exact: true }).click();
    await expect(online.getByText("Remote snapshot / read only", { exact: true })).toBeVisible();
    await online.keyboard.press("Escape");
    await online.getByRole("button", { name: "Open note panel" }).click();
    // HTML textareas normalize CRLF for display; the two extension snapshots above
    // and the independent decoder verify the original CRLF byte-for-byte.
    await expect(online.getByRole("textbox", { name: "Note content" })).toHaveValue(notes[0].content.replace(/\r\n/g, "\n"));
    await online.keyboard.press("Escape");
    await online.getByRole("button", { name: "Open settings" }).click();
    await online.getByRole("textbox", { name: "GitHub token" }).fill("wrong-but-api-valid");
    await online.getByRole("button", { name: "SAVE", exact: true }).click();
    await expect(online.locator(".sync-toast")).toContainText("Unable to decrypt Notes");
    expect(writes).toBe(1);

    // Lose both PATCH acknowledgements after GitHub stores the replacement ciphertext.
    dropWriteResponse = true;
    const failed = await request(a.page, { type: "SAVE_TOKEN", token: replacement, rememberToken: true });
    expect(failed.ok).toBe(false);
    expect(failed.state?.token).toBe(token);
    expect(failed.state?.notes).toEqual(notes);
    const migration = await a.page.evaluate(async () => (await chrome.storage.local.get("firstlight")).firstlight.tokenMigration);
    expect(migration.token).toBe(replacement);
    const writesAfterFailure = writes;
    dropWriteResponse = false;
    const cdp = await a.context.newCDPSession(a.page);
    const targets = await cdp.send("Target.getTargets");
    const target = targets.targetInfos.find((item) => item.type === "service_worker" && item.url === a.worker.url());
    await cdp.send("Target.closeTarget", { targetId: target!.targetId });
    const resumed = await request(a.page, { type: "SAVE_TOKEN", token: replacement, rememberToken: true });
    expect(resumed.ok, resumed.error).toBe(true);
    expect(resumed.state?.token).toBe(replacement);
    expect(resumed.state?.notes).toEqual(notes);
    expect(writes).toBe(writesAfterFailure);
    await cdp.detach();
    failReads = true;
    const offline = await request(a.page, { type: "UPLOAD_NOW" });
    expect(offline.ok).toBe(false);
    expect(offline.state?.notes).toEqual(notes);
    expect(writes).toBe(writesAfterFailure);
    await testInfo.attach("browser-sync-measurement.json", {
      contentType: "application/json",
      body: JSON.stringify({
        sample: "synthetic repetitive multilingual Notes, mocked GitHub",
        noteBytes: Buffer.byteLength(notes[0].content),
        fileBytes: Buffer.byteLength(content!),
        uploadMs,
        independentExtensionReadMs: readMs
      })
    });
  } finally {
    for (const context of contexts.reverse()) await context.close();
    for (const profile of profiles) await rm(profile, { recursive: true, force: true });
  }
});
