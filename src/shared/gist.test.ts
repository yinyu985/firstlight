import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, GIST_DESCRIPTION, snapshotFrom, type Snapshot } from "./model";
import { GistClient, normalizeGitHubToken } from "./gist";
import { decodeGistSnapshot, encodeGistSnapshot } from "./notesEnvelope";

const emptyNotes = JSON.parse(await encodeGistSnapshot(snapshotFrom([], DEFAULT_SETTINGS), "github_pat_test")).notes;

afterEach(() => vi.restoreAllMocks());

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
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
    files: files ?? { "firstlight.json": { content: JSON.stringify({ ...snapshot, notes: emptyNotes }), truncated: false } }
  };
}

describe("normalizeGitHubToken", () => {
  it("reuses this operation's secret read while still independently verifying the write", async () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(gistResponse({ snapshot })));
    const client = new GistClient("github_pat_test");
    const remote = await client.read("gist-id");
    await client.update("gist-id", snapshot, remote);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
    fetchMock.mockClear();
    // A previous operation's proof cannot be used a second time.
    await client.update("gist-id", snapshot, remote);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
  });
  it("removes copied whitespace and surrounding quotes", () => {
    expect(normalizeGitHubToken("  “github_pat_abc123”\n")).toBe("github_pat_abc123");
  });

  it("rejects non-ASCII header characters with a useful error", () => {
    expect(() => normalizeGitHubToken("GitHub Token：github_pat_abc123")).toThrow(/unsupported characters/i);
  });

  it("retries a Chrome-interrupted read without blaming the user", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new DOMException("The user aborted a request", "AbortError"))
      .mockResolvedValueOnce(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(new GistClient("github_pat_test").discover()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a timed-out GET once", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(new GistClient("github_pat_test").discover()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries an interrupted PATCH once", async () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot })))
      .mockRejectedValueOnce(new DOMException("The request was interrupted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot })))
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot })));

    await expect(new GistClient("github_pat_test").update("gist-id", snapshot)).resolves.toMatchObject({ gistId: "gist-id" });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PATCH", "PATCH", "GET"]);
  });

  it("reconciles an interrupted POST instead of creating a duplicate Gist", async () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new DOMException("The request was interrupted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse([gistResponse({ snapshot })]))
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot })));

    await expect(new GistClient("github_pat_test").create(snapshot)).resolves.toMatchObject({ gistId: "gist-id" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not blindly repeat an indeterminate POST", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new DOMException("The request was interrupted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(new GistClient("github_pat_test").create(snapshotFrom([], DEFAULT_SETTINGS))).rejects.toThrow(
      "not repeated to avoid creating a duplicate Gist"
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not retry a definite 4xx response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "Not Found" }, 404));

    await expect(new GistClient("github_pat_test").discover()).rejects.toThrow("Not Found");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("paginates discovery and returns only secret Firstlight Gists", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      gistResponse({
        id: `other-${index}`,
        description: "Other Gist",
        files: {}
      })
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([gistResponse({ id: "public-match", isPublic: true }), gistResponse({ id: "secret-match" })]));

    await expect(new GistClient("github_pat_test").discover()).resolves.toEqual([expect.objectContaining({ gistId: "secret-match" })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("page=1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("page=2");
  });

  it("refuses to read or update a public Gist", async () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
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
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
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
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          gistResponse({
            files: { "firstlight.json": { content: JSON.stringify(malformed), truncated: false } }
          })
        )
      )
      .mockResolvedValueOnce(jsonResponse(gistResponse({ snapshot: intended })));

    await expect(new GistClient("github_pat_test").create(intended)).resolves.toMatchObject({
      gistId: "gist-id",
      snapshot: expect.objectContaining({ bookmarks: intended.bookmarks })
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uploads indented JSON with encrypted Notes and unchanged public fields", async () => {
    const snapshot = snapshotFrom([{ title: "Example", url: "https://example.com" }], DEFAULT_SETTINGS);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (!init?.body) return jsonResponse(gistResponse({ snapshot }));
      const body = JSON.parse(String(init?.body)) as { files: Record<string, { content: string }> };
      const content = body.files["firstlight.json"].content;
      const encoded = JSON.parse(content);
      expect(encoded.bookmarks).toEqual(snapshot.bookmarks);
      expect(encoded.config).toEqual(snapshot.config);
      expect(encoded.notes.format).toBe("firstlight.notes.encrypted");
      expect(content).toBe(JSON.stringify(encoded, null, 2));
      expect((await decodeGistSnapshot(content, "github_pat_test")).snapshot).toEqual(snapshot);
      return new Response(
        JSON.stringify({
          id: "gist-id",
          html_url: "https://gist.github.com/gist-id",
          updated_at: "2026-08-12T04:00:00Z",
          public: false,
          files: { "firstlight.json": { content, truncated: false } }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(new GistClient("github_pat_test").create(snapshot)).resolves.toMatchObject({ gistId: "gist-id" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a separately named manual path to upgrade validated plaintext Notes", async () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    let content = JSON.stringify(snapshot);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") content = JSON.parse(String(init.body)).files["firstlight.json"].content;
      return jsonResponse(
        gistResponse({
          snapshot,
          files: { "firstlight.json": { content, truncated: false } }
        })
      );
    });
    const client = new GistClient("github_pat_test");

    await expect(client.read("gist-id")).rejects.toThrow(/Unsupported Notes format/);
    const legacy = await client.readForEncryptionUpgrade("gist-id");
    await expect(client.update("gist-id", snapshot, legacy)).resolves.toMatchObject({ snapshot });

    expect(JSON.parse(content).notes.format).toBe("firstlight.notes.encrypted");
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "GET", "PATCH", "GET"]);
  });
});
