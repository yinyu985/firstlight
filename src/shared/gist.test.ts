import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, GIST_DESCRIPTION, snapshotFrom, type Snapshot } from "./model";
import { GistClient, normalizeGitHubToken } from "./gist";

afterEach(() => vi.restoreAllMocks());

const jsonResponse = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" }
});

function gistResponse({
  id = "gist-id",
  isPublic = false,
  description = GIST_DESCRIPTION,
  snapshot = snapshotFrom([], DEFAULT_SETTINGS),
  files
}: {
  id?: string;
  isPublic?: boolean;
  description?: string;
  snapshot?: Snapshot;
  files?: Record<string, unknown>;
} = {}) {
  return {
    id,
    description,
    html_url: `https://gist.github.com/${id}`,
    updated_at: "2026-08-12T04:00:00Z",
    public: isPublic,
    files: files ?? { "firstlight.json": { content: JSON.stringify(snapshot, null, 2), truncated: false } }
  };
}

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

  it("retries a timed-out GET once", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(new GistClient("github_pat_test").discover()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a definite 4xx response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ message: "Not Found" }, 404));

    await expect(new GistClient("github_pat_test").discover()).rejects.toThrow("Not Found");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("paginates discovery and returns only secret Firstlight Gists", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => gistResponse({
      id: `other-${index}`,
      description: "Other Gist",
      files: {}
    }));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([
        gistResponse({ id: "public-match", isPublic: true }),
        gistResponse({ id: "secret-match" })
      ]));

    await expect(new GistClient("github_pat_test").discover()).resolves.toEqual([
      expect.objectContaining({ gistId: "secret-match" })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("page=1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("page=2");
  });

  it("refuses to read or update a public Gist", async () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(gistResponse({ isPublic: true, snapshot })))
      .mockResolvedValueOnce(jsonResponse(gistResponse({ isPublic: true, snapshot })));
    const client = new GistClient("github_pat_test");

    await expect(client.read("gist-id")).rejects.toThrow(/public Gist/i);
    await expect(client.update("gist-id", snapshot)).rejects.toThrow(/public Gist/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it("blocks an invalid snapshot before issuing a write request", async () => {
    const note = {
      id: "duplicate",
      name: "Note",
      content: "",
      createtime: "2026-08-12T10:00:00.000+08:00",
      updatetime: "2026-08-12T10:00:00.000+08:00"
    };
    const invalid = { ...snapshotFrom([], DEFAULT_SETTINGS), notes: [note, { ...note }] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));

    await expect(new GistClient("github_pat_test").create(invalid)).rejects.toThrow("Duplicate note id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("independently reads a mismatched write response before accepting success", async () => {
    const intended = snapshotFrom([{ title: "Intended", url: "https://example.com/intended" }], DEFAULT_SETTINGS);
    const stale = snapshotFrom([{ title: "Stale", url: "https://example.com/stale" }], DEFAULT_SETTINGS);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot: stale })))
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot: intended })));

    await expect(new GistClient("github_pat_test").create(intended)).resolves.toMatchObject({
      gistId: "gist-id",
      snapshot: expect.objectContaining({ bookmarks: intended.bookmarks })
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("independently reads when inline write content fails snapshot validation", async () => {
    const intended = snapshotFrom([{ title: "Intended", url: "https://example.com/intended" }], DEFAULT_SETTINGS);
    const malformed = { ...intended, notes: {} };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(gistResponse({
        files: { "firstlight.json": { content: JSON.stringify(malformed), truncated: false } }
      })))
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot: intended })));

    await expect(new GistClient("github_pat_test").create(intended)).resolves.toMatchObject({
      gistId: "gist-id",
      snapshot: expect.objectContaining({ bookmarks: intended.bookmarks })
    });
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
        public: false,
        files: { "firstlight.json": { content, truncated: false } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(new GistClient("github_pat_test").create(snapshot)).resolves.toMatchObject({ gistId: "gist-id" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
