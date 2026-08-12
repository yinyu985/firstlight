import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, snapshotFrom } from "./model";
import { GistClient, normalizeGitHubToken } from "./gist";

afterEach(() => vi.restoreAllMocks());

describe("normalizeGitHubToken", () => {
  it("removes copied whitespace and surrounding quotes", () => {
    expect(normalizeGitHubToken("  “github_pat_abc123”\n")).toBe("github_pat_abc123");
  });

  it("rejects non-ASCII header characters with a useful error", () => {
    expect(() => normalizeGitHubToken("GitHub Token：github_pat_abc123")).toThrow(/unsupported characters/i);
  });

  it("retries a Chrome-interrupted read without blaming the user", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new DOMException("The user aborted a request", "AbortError"))
      .mockResolvedValueOnce(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(new GistClient("github_pat_test").discover()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("measures and uploads the exact same pretty snapshot text", async () => {
    const snapshot = snapshotFrom([{ title: "Example", url: "https://example.com" }], DEFAULT_SETTINGS);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { files: Record<string, { content: string }> };
      const content = body.files["firstlight.json"].content;
      expect(content).toBe(JSON.stringify(snapshot, null, 2));
      return new Response(JSON.stringify({
        id: "gist-id",
        html_url: "https://gist.github.com/gist-id",
        updated_at: "2026-08-12T04:00:00Z",
        files: { "firstlight.json": { content, truncated: false } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(new GistClient("github_pat_test").create(snapshot)).resolves.toMatchObject({ gistId: "gist-id" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
