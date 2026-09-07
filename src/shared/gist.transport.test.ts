import { afterEach, describe, expect, it, vi } from "vitest";
import { GistClient, GitHubError, GITHUB_OPERATION_TIMEOUT_MS, isRetryableGitHubError, readBoundedText } from "./gist";
import { DEFAULT_SETTINGS, GIST_DESCRIPTION, snapshotFrom } from "./model";
import { encodeGistSnapshot } from "./notesEnvelope";
import * as notesEnvelope from "./notesEnvelope";

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
  it.each([
    { value: null },
    { value: { message: "unexpected object" } },
    { value: [null] },
    { value: [{ ...gist, files: null }] },
    { value: [{ ...gist, updated_at: "not-a-date" }] },
    { value: [{ ...gist, html_url: "https://elsewhere.test/gist" }] },
    { value: [{ ...gist, files: { "firstlight.json": { content: 123 } } }] }
  ])("rejects malformed discovery responses without writing or exposing their contents", async ({ value }) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(value));
    await expect(new GistClient("test-token").discover()).rejects.toBeInstanceOf(GitHubError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("redacts the current token from GitHub error details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Invalid credential: test-token" }), { status: 401 }));
    await expect(new GistClient("test-token").discover()).rejects.toThrow("Invalid credential: [redacted]");
  });
  it("reports invalid JSON rather than a raw parsing error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Private unexpected response"));
    await expect(new GistClient("test-token").discover()).rejects.toThrow("GitHub returned invalid JSON");
  });
  it("applies an overall deadline across discovery pages and marks expiry as retryable", async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((duration) => (duration === GITHUB_OPERATION_TIMEOUT_MS ? deadline.signal : new AbortController().signal));
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(false);
      deadline.abort(new DOMException("Operation timed out", "TimeoutError"));
      expect(init?.signal?.aborted).toBe(true);
      return json(Array.from({ length: 100 }, () => gist));
    });
    const error = await new GistClient("test-token").discover().catch((cause: unknown) => cause);
    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(isRetryableGitHubError(error)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps deadline expiry retryable if it interrupts Notes encoding before upload", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.spyOn(notesEnvelope, "encodeGistSnapshot").mockImplementation(async () => {
      deadline.abort(new DOMException("Operation timed out", "TimeoutError"));
      throw deadline.signal.reason;
    });
    const fetch = vi.spyOn(globalThis, "fetch");
    const error = await new GistClient("test-token").create(snapshot).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(isRetryableGitHubError(error)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("handles a non-string API error message without retrying a permanent HTTP failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: { unexpected: true } }), { status: 403 }));
    await expect(new GistClient("test-token").discover()).rejects.toMatchObject({ status: 403, message: "GitHub request failed (403)" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

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
