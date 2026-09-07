import { expect, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, GIST_DESCRIPTION, snapshotFrom, type Snapshot } from "../src/shared/model";

export function sampleSnapshot(): Snapshot {
  return snapshotFrom([{ title: "Work", children: [{ title: "Guide", url: "https://example.test/guide" }] }], DEFAULT_SETTINGS, [
    { id: "a", name: "Recently edited", content: "Alpha", createtime: "2026-08-01T10:00:00.000+08:00", updatetime: "2026-08-03T10:00:00.000+08:00" },
    { id: "b", name: "Recently created", content: "Beta", createtime: "2026-08-02T10:00:00.000+08:00", updatetime: "2026-08-02T10:00:00.000+08:00" }
  ]);
}

export async function mockGitHub(page: Page, snapshot = sampleSnapshot()) {
  await page.route("https://api.github.com/**", async (route) => {
    if (route.request().headers().authorization !== "Bearer firstlight-e2e-token") {
      await route.fulfill({ status: 401, json: { message: "Bad credentials" } });
      return;
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
}

export async function connectOnline(page: Page, snapshot = sampleSnapshot()) {
  await mockGitHub(page, snapshot);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("textbox", { name: "GitHub token" }).fill("firstlight-e2e-token");
  await page.getByRole("button", { name: "SAVE", exact: true }).click();
  await expect(page.getByText("Remote snapshot / read only", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
}
