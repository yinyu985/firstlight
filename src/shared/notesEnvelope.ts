import { MAX_SNAPSHOT_BYTES, type Snapshot } from "./model";
import { inspectSettings, parseSnapshotWithDiagnostics, SnapshotValidationError, validateNotes, validateSnapshot } from "./snapshot";

const encoder = new TextEncoder();
const HEADER = { format: "firstlight.notes.encrypted", version: 1, compression: "gzip", kdf: "HKDF-SHA-256", cipher: "AES-256-GCM" } as const;
const CONTEXT = encoder.encode("firstlight/notes-envelope/v1");
const KEYS = [...Object.keys(HEADER), "salt", "iv", "items", "data"];
const NOTE_METADATA_KEYS = ["id", "name", "createtime", "updatetime"];

export class NotesDecryptionError extends SnapshotValidationError {
  constructor() {
    super("Unable to decrypt Notes. Use the same Gist token that encrypted them; the file may also be damaged.");
    this.name = "NotesDecryptionError";
  }
}

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(""));
}

function unbase64(value: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(max / 3) || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new SnapshotValidationError("Invalid Notes envelope Base64 or length");
  }
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (bytes.length < min || bytes.length > max || base64(bytes) !== value) throw new SnapshotValidationError("Invalid Notes envelope length or encoding");
  return bytes;
}

async function key(token: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (!token) throw new NotesDecryptionError();
  const material = await crypto.subtle.importKey("raw", encoder.encode(token), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: CONTEXT }, material, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
}

/** Bound output while consuming the stream, rather than after an unbounded Response.arrayBuffer(). */
async function transform(bytes: Uint8Array<ArrayBuffer>, decompress: boolean, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  const stream = new Blob([bytes]).stream().pipeThrough(decompress ? new DecompressionStream("gzip") : new CompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SNAPSHOT_BYTES) {
        await reader.cancel();
        throw new SnapshotValidationError(
          decompress ? "Decompressed Notes exceed the 10 MiB business snapshot limit" : "Encoded Notes exceed the 10 MiB transfer limit"
        );
      }
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export async function encodeGistSnapshot(snapshot: Snapshot, token: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const canonical = validateSnapshot(snapshot);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // Keep titles inspectable in Gist. Compress all bodies together for good ratios
  // even with many short Notes, using only one gzip stream and key derivation.
  const items = canonical.notes.map(({ id, name, createtime, updatetime }) => ({ id, name, createtime, updatetime }));
  const header = { ...HEADER, salt: base64(salt), iv: base64(iv), items };
  const compressed = await transform(encoder.encode(JSON.stringify(canonical.notes.map((note) => note.content))), false, signal);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(JSON.stringify(header)), tagLength: 128 },
    await key(token, salt),
    compressed
  );
  signal?.throwIfAborted();
  const text = JSON.stringify({ ...canonical, notes: { ...header, data: base64(new Uint8Array(encrypted)) } });
  if (encoder.encode(text).byteLength > MAX_SNAPSHOT_BYTES) throw new SnapshotValidationError("Encoded firstlight.json exceeds the 10 MiB transfer limit");
  return text;
}

export async function decodeGistSnapshot(text: string, token: string, signal?: AbortSignal): Promise<ReturnType<typeof parseSnapshotWithDiagnostics>> {
  signal?.throwIfAborted();
  if (encoder.encode(text).byteLength > MAX_SNAPSHOT_BYTES) throw new SnapshotValidationError("Encoded firstlight.json exceeds the 10 MiB transfer limit");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new SnapshotValidationError("firstlight.json is not valid JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return parseSnapshotWithDiagnostics(text);
  const raw = input as Record<string, unknown>;
  if (!raw.notes || typeof raw.notes !== "object" || Array.isArray(raw.notes))
    throw new SnapshotValidationError("Unsupported Notes format. Update all clients to the current Notes encryption format.");
  const envelope = raw.notes as Record<string, unknown>;
  if (
    Object.keys(envelope).length !== KEYS.length ||
    Object.keys(envelope).some((field) => !KEYS.includes(field)) ||
    Object.entries(HEADER).some(([field, value]) => envelope[field] !== value)
  ) {
    throw new SnapshotValidationError("Unsupported or invalid Notes envelope format, version or algorithms");
  }
  if (!Array.isArray(envelope.items)) throw new SnapshotValidationError("Invalid Notes metadata list");
  const metadata = validateNotes(
    envelope.items.map((item: unknown) => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).length !== NOTE_METADATA_KEYS.length ||
        Object.keys(item).some((field) => !NOTE_METADATA_KEYS.includes(field))
      ) {
        throw new SnapshotValidationError("Invalid Notes metadata fields");
      }
      return { ...item, content: "" };
    })
  );
  // Reject unsupported business versions and invalid public fields before crypto.
  validateSnapshot({ ...raw, notes: metadata });
  const salt = unbase64(envelope.salt, 32, 32);
  const iv = unbase64(envelope.iv, 12, 12);
  const data = unbase64(envelope.data, 16, MAX_SNAPSHOT_BYTES);
  const items = metadata.map(({ id, name, createtime, updatetime }) => ({ id, name, createtime, updatetime }));
  const header = { ...HEADER, salt: envelope.salt, iv: envelope.iv, items };
  let decrypted: ArrayBuffer;
  const derivedKey = await key(token, salt);
  signal?.throwIfAborted();
  try {
    decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(JSON.stringify(header)), tagLength: 128 }, derivedKey, data);
  } catch {
    throw new NotesDecryptionError();
  }
  signal?.throwIfAborted();
  const notes = await transform(new Uint8Array(decrypted), true, signal);
  let contents: unknown;
  try {
    contents = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(notes));
  } catch {
    throw new SnapshotValidationError("Decrypted Notes are not valid UTF-8 JSON");
  }
  if (!Array.isArray(contents) || contents.length !== metadata.length || contents.some((body) => typeof body !== "string")) {
    throw new SnapshotValidationError("Decrypted Notes content list does not match the metadata");
  }
  raw.notes = metadata.map((note, index) => ({ ...note, content: contents[index] }));
  const snapshot = validateSnapshot(raw);
  const { repair, fields } = inspectSettings(raw.config);
  signal?.throwIfAborted();
  return { snapshot, settingsRepair: repair, settingsRepairFields: fields };
}
