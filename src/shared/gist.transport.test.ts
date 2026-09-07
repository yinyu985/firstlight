import { afterEach, describe, expect, it, vi } from "vitest";
import { GistClient, GitHubError, isRetryableGitHubError, readBoundedText } from "./gist";
import { DEFAULT_SETTINGS, GIST_DESCRIPTION, snapshotFrom } from "./model";
import { encodeGistSnapshot } from "./notesEnvelope";

afterEach(() => vi.restoreAllMocks());
const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
const gist = {
  id: "a",
  public: false,
  html_url: "https://gist.github.com/a",
  description: GIST_DESCRIPTION,
  updated_at: "2026-08-20T09:00:00Z",
  files: { "firstlight.json": { content: await encodeGistSnapshot(snapshot, "test-token") } }
};
const json = (value: unknown) => new Response(JSON.stringify(value));
const interrupted = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new DOMException("Interrupted body", "AbortError"));
      }
    })
  );

describe("GitHub transport failure boundaries", () => {
  it("independently reads after a matching PATCH response", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(gist));
    await new GistClient("test-token").update("a", snapshot);
    expect(fetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
  });
  it("does not trust a matching acknowledgement if the independent read differs", async () => {
    const changed = structuredClone(gist);
    changed.files["firstlight.json"].content = await encodeGistSnapshot(
      snapshotFrom([{ title: "Other", url: "https://other.test" }], DEFAULT_SETTINGS),
      "test-token"
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(gist)).mockResolvedValueOnce(json(gist)).mockResolvedValueOnce(json(changed));
    await expect(new GistClient("test-token").update("a", snapshot)).rejects.toThrow(/different Firstlight snapshot/i);
  });
  it("retries a GET whose response body is interrupted", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(interrupted()).mockResolvedValueOnce(json([]));
    await expect(new GistClient("test-token").discover()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reconciles an interrupted POST response body without posting twice", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(interrupted())
      .mockResolvedValueOnce(json([gist]))
      .mockResolvedValueOnce(json(gist));
    await expect(new GistClient("test-token").create(snapshot)).resolves.toMatchObject({ gistId: "a" });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("cancels a streamed body as soon as it exceeds its byte budget", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(64));
      },
      cancel
    });
    await expect(readBoundedText(new Response(stream), 100)).rejects.toThrow(/size/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("checks declared length before reading a response", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    await expect(readBoundedText(new Response(stream, { headers: { "Content-Length": "101" } }), 100)).rejects.toThrow(/size/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("stops discovery pagination when the connection is cancelled", async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      controller.abort();
      return json(Array.from({ length: 100 }, () => gist));
    });
    await expect(new GistClient("test-token", controller.signal).discover()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("distinguishes permanent errors from temporary and rate-limit failures", async () => {
    expect(isRetryableGitHubError(new GitHubError("Forbidden", 403))).toBe(false);
    expect(isRetryableGitHubError(new GitHubError("Too large"))).toBe(false);
    expect(isRetryableGitHubError(new GitHubError("Offline", undefined, "network"))).toBe(true);
    const retryAt = Date.now() + 60_000;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Math.ceil(retryAt / 1000)) }
      })
    );
    const error = await new GistClient("test-token").discover().catch((cause: unknown) => cause);
    expect(isRetryableGitHubError(error)).toBe(true);
    expect((error as GitHubError).retryAt).toBeGreaterThanOrEqual(retryAt);
  });
});
