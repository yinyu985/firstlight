import { afterEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { DEFAULT_SETTINGS, MAX_SNAPSHOT_BYTES, snapshotFrom } from "./model";
import { decodeGistSnapshot, encodeGistSnapshot, NotesDecryptionError } from "./notesEnvelope";
import { snapshotHash } from "./snapshot";
import { GistClient, isRetryableGitHubError } from "./gist";

const token = "github_pat_independent-fixture";
const time = "2026-09-07T10:00:00.000+08:00";
const note = { id: "private-id", name: "私密标题🔐", content: "中文🙂\r\n换行\n\t\u0000é", createtime: time, updatetime: time };
const snapshot = snapshotFrom([{ title: "Visible", url: "data:text/plain,opaque%00" }], DEFAULT_SETTINGS, [note], time);
const json = (value: unknown) => new Response(JSON.stringify(value));
const gist = (content: string) => ({
  id: "fixture",
  owner: { id: 1 },
  public: false,
  description: "Firstlight snapshot",
  html_url: "https://gist.github.com/fixture",
  updated_at: time,
  files: { "firstlight.json": { content } }
});
afterEach(() => vi.restoreAllMocks());

// Independently constructs the documented wire format, not a codec round trip.
async function externalEnvelope(notes: string): Promise<string> {
  const salt = new Uint8Array(32).fill(7),
    iv = new Uint8Array(12).fill(3);
  const header = {
    format: "firstlight.notes.encrypted",
    version: 1,
    compression: "gzip",
    kdf: "HKDF-SHA-256",
    cipher: "AES-256-GCM",
    salt: Buffer.from(salt).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    items: snapshot.notes.map(({ id, name, createtime, updatetime }) => ({ id, name, createtime, updatetime }))
  };
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("firstlight/notes-envelope/v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128, additionalData: new TextEncoder().encode(JSON.stringify(header)) },
    key,
    new Uint8Array(gzipSync(notes))
  );
  return JSON.stringify({ ...snapshot, notes: { ...header, data: Buffer.from(data).toString("base64") } });
}

describe("Notes-only Gist envelope", () => {
  it("reads an independently generated file with only the token, salt and IV", async () => {
    expect((await decodeGistSnapshot(await externalEnvelope(JSON.stringify(snapshot.notes.map((note) => note.content))), token)).snapshot).toEqual(snapshot);
  });
  it("preserves complete Unicode Notes, leaves public fields visible and randomizes each encryption", async () => {
    const a = await encodeGistSnapshot(snapshot, token),
      b = await encodeGistSnapshot(snapshot, token);
    const raw = JSON.parse(a);
    expect(raw.bookmarks).toEqual(snapshot.bookmarks);
    expect(raw.config).toEqual(snapshot.config);
    for (const secret of [token, note.content]) expect(a).not.toContain(secret);
    expect(raw.notes.items).toEqual([{ id: note.id, name: note.name, createtime: time, updatetime: time }]);
    expect(a).not.toBe(b);
    expect(raw.notes.salt).not.toBe(JSON.parse(b).notes.salt);
    expect(raw.notes.iv).not.toBe(JSON.parse(b).notes.iv);
    const decoded = (await decodeGistSnapshot(a, token)).snapshot;
    expect(decoded).toEqual(snapshot);
    expect(await snapshotHash(decoded)).toBe(await snapshotHash((await decodeGistSnapshot(b, token)).snapshot));
  });
  it("rejects legacy plaintext and unsupported business schemas without migration", async () => {
    await expect(decodeGistSnapshot(JSON.stringify(snapshot), token)).rejects.toThrow(/Unsupported Notes format/);
    const raw = JSON.parse(await encodeGistSnapshot(snapshot, token));
    raw.schemaVersion = 100;
    await expect(decodeGistSnapshot(JSON.stringify(raw), token)).rejects.toThrow(/version/);
  });
  it("keeps settings repair diagnostics after decryption", async () => {
    const raw = JSON.parse(await encodeGistSnapshot(snapshot, token));
    raw.config.foreground.fontSize = -1;
    const decoded = await decodeGistSnapshot(JSON.stringify(raw), token);
    expect(decoded.settingsRepair).toBe("fields");
    expect(decoded.snapshot.notes).toEqual(snapshot.notes);
  });
  it.each(["version", "compression", "kdf", "cipher", "format", "salt", "iv", "data", "extra"])(
    "rejects a modified %s without plaintext fallback",
    async (field) => {
      const raw = JSON.parse(await encodeGistSnapshot(snapshot, token));
      if (["salt", "iv", "data"].includes(field)) raw.notes[field] = (raw.notes[field][0] === "A" ? "B" : "A") + raw.notes[field].slice(1);
      else raw.notes[field] = "unsupported";
      const error = await decodeGistSnapshot(JSON.stringify(raw), token).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(Error);
      expect(isRetryableGitHubError(error)).toBe(false);
    }
  );
  it("rejects wrong tokens, malformed Base64, truncation and invalid Notes schema", async () => {
    const text = await encodeGistSnapshot(snapshot, token);
    await expect(decodeGistSnapshot(text, "different-token")).rejects.toBeInstanceOf(NotesDecryptionError);
    await expect(decodeGistSnapshot(text.slice(0, -8), token)).rejects.toThrow(/JSON/);
    const raw = JSON.parse(text);
    raw.notes.data = "!invalid!";
    await expect(decodeGistSnapshot(JSON.stringify(raw), token)).rejects.toThrow(/Base64/);
    await expect(decodeGistSnapshot(await externalEnvelope(JSON.stringify([2])), token)).rejects.toThrow(/content/);
  });
  it("bounds authenticated decompression and decoded total business size", async () => {
    const bomb = await externalEnvelope(JSON.stringify(["x".repeat(MAX_SNAPSHOT_BYTES)]));
    await expect(decodeGistSnapshot(bomb, token)).rejects.toThrow(/Decompressed Notes.*10 MiB/);
    const raw = JSON.parse(await externalEnvelope(JSON.stringify(["x".repeat(MAX_SNAPSHOT_BYTES - 2000)])));
    raw.bookmarks = [{ title: "z".repeat(3000), url: "https://example.test" }];
    await expect(decodeGistSnapshot(JSON.stringify(raw), token)).rejects.toThrow(/Business snapshot/);
  });
  it("authenticates visible titles and their ordering to prevent body/metadata swaps", async () => {
    const multiple = { ...snapshot, notes: [note, { ...note, id: "second", name: "Second title", content: "second body" }] };
    const encoded = await encodeGistSnapshot(multiple, token);
    for (const change of ["title", "order", "id", "time"] as const) {
      const raw = JSON.parse(encoded);
      if (change === "title") raw.notes.items[0].name = "Different title";
      if (change === "id") raw.notes.items[0].id = "different-id";
      if (change === "time") raw.notes.items[0].updatetime = "2026-09-08T10:00:00.000+08:00";
      if (change === "order") raw.notes.items.reverse();
      await expect(decodeGistSnapshot(JSON.stringify(raw), token)).rejects.toBeInstanceOf(NotesDecryptionError);
    }
    await expect(decodeGistSnapshot(await externalEnvelope(JSON.stringify([])), token)).rejects.toThrow(/match the metadata/);
  });
  it("preserves empty bodies, escapes and lone UTF-16 surrogates exactly", async () => {
    const bodies = ["", "\\ud800", "\\udfff", "\\r\\n\\n\\t\\u0000", '\\"\\\\/', "中文🙂é"];
    const many = { ...snapshot, notes: bodies.map((content, i) => ({ ...note, id: String(i), content })) };
    expect((await decodeGistSnapshot(await encodeGistSnapshot(many, token), token)).snapshot).toEqual(many);
    const empty = { ...snapshot, notes: [] };
    expect((await decodeGistSnapshot(await encodeGistSnapshot(empty, token), token)).snapshot).toEqual(empty);
  });
  it("rejects an incompressible final file over the transfer limit without making a request", async () => {
    const alphabet = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)).filter((char) => char !== '"' && char !== "\\\\");
    const random = randomBytes(Math.floor(MAX_SNAPSHOT_BYTES * 0.98));
    const parts: string[] = [];
    for (let offset = 0; offset < random.length; offset += 8192)
      parts.push(Array.from(random.subarray(offset, offset + 8192), (byte) => alphabet[byte % alphabet.length]).join(""));
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(new GistClient(token).create({ ...snapshot, notes: [{ ...note, content: parts.join("") }] })).rejects.toThrow(
      /Encoded firstlight.json.*transfer limit/
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds encoded input before parsing and cancels stale decoding", async () => {
    await expect(decodeGistSnapshot(" ".repeat(MAX_SNAPSHOT_BYTES + 1), token)).rejects.toThrow(/transfer limit/);
    const text = await encodeGistSnapshot(snapshot, token);
    const controller = new AbortController();
    const pending = decodeGistSnapshot(text, token, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
  it("compresses large single-line and multiline Notes without losing a character", async () => {
    for (const content of ["中文🙂abcdef".repeat(80_000), "Line with English and 中文🙂\n".repeat(40_000)]) {
      const large = { ...snapshot, notes: [{ ...note, content }] };
      const encoded = await encodeGistSnapshot(large, token);
      expect(encoded.length).toBeLessThan(Buffer.byteLength(JSON.stringify(large)) / 5);
      expect((await decodeGistSnapshot(encoded, token)).snapshot.notes).toEqual(large.notes);
    }
  });
  it("reads uploaded data from an independent client and a truncated raw response", async () => {
    let stored = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (init?.method === "POST") stored = JSON.parse(String(init.body)).files["firstlight.json"].content;
      if (String(url).startsWith("https://gist.githubusercontent.com/")) return new Response(stored);
      const response = gist(stored);
      return json(
        init?.method === "POST"
          ? response
          : { ...response, files: { "firstlight.json": { truncated: true, raw_url: "https://gist.githubusercontent.com/fixture/raw/firstlight.json" } } }
      );
    });
    await new GistClient(token).create(snapshot);
    expect((await new GistClient(` “${token}” `).read("fixture")).snapshot).toEqual(snapshot);
    await expect(new GistClient("wrong").update("fixture", snapshot)).rejects.toBeInstanceOf(NotesDecryptionError);
  });
  it("rekeys with a revoked old token used only locally and resumes without a second PATCH", async () => {
    let stored = await encodeGistSnapshot(snapshot, "revoked-old-token");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
      if (String(url).endsWith("/user")) return json({ id: 1 });
      if (init?.method === "PATCH") stored = JSON.parse(String(init.body)).files["firstlight.json"].content;
      return json(gist(stored));
    });
    expect((await new GistClient(token).rekey("fixture", "revoked-old-token")).snapshot).toEqual(snapshot);
    expect((await new GistClient(token).rekey("fixture")).snapshot).toEqual(snapshot);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    await expect(decodeGistSnapshot(stored, "revoked-old-token")).rejects.toBeInstanceOf(NotesDecryptionError);
  });
  it("never rekeys someone else's Gist or corrupt data", async () => {
    const stored = await encodeGistSnapshot(snapshot, "old");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => json(String(url).endsWith("/user") ? { id: 2 } : gist(stored)));
    await expect(new GistClient(token).rekey("fixture", "old")).rejects.toThrow(/own Gist/);
    expect(fetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
});
