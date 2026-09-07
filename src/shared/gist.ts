import { GIST_DESCRIPTION, MAX_SNAPSHOT_BYTES, SNAPSHOT_FILE_NAME, type Snapshot } from "./model";
import { parseSnapshotWithDiagnostics, snapshotHash, validateSnapshot, type SettingsRepair } from "./snapshot";
import { decodeGistSnapshot, encodeGistSnapshot, NotesDecryptionError, UnsupportedNotesFormatError } from "./notesEnvelope";

interface GistFile {
  filename?: string;
  content?: string;
  raw_url?: string;
  truncated?: boolean;
}

interface GistResponse {
  id: string;
  description?: string;
  html_url: string;
  updated_at: string;
  public: boolean;
  files: Record<string, GistFile>;
  owner?: { id: number };
}

export interface RemoteSnapshot {
  gistId: string;
  htmlUrl: string;
  updatedAt: string;
  snapshot: Snapshot;
  settingsRepair?: SettingsRepair;
  settingsRepairFields?: string[];
}

type GitHubFailureKind = "timeout" | "interrupted" | "network";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind?: GitHubFailureKind,
    readonly retryAt?: number,
    readonly rateLimited = false
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export function isRetryableGitHubError(error: unknown): error is GitHubError {
  return error instanceof GitHubError && (Boolean(error.kind) || error.rateLimited || error.status === 429 || (error.status ?? 0) >= 500);
}

/** Count received bytes before decoding or allocating one unbounded string. */
export async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("Content-Length"));
  if (declared > limit) {
    await response.body?.cancel();
    throw new GitHubError("GitHub response exceeds the supported download size");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new GitHubError("GitHub response exceeds the supported download size");
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

function transportError(error: unknown): unknown {
  if (error instanceof GitHubError) return error;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || /timed?\s*out|timeout/iu.test(message)) return new GitHubError("GitHub request timed out", undefined, "timeout");
  if (name === "AbortError" || /abort|interrupt/iu.test(message))
    return new GitHubError("GitHub request was interrupted by Chrome. Please retry.", undefined, "interrupted");
  if (error instanceof TypeError) return new GitHubError("GitHub request failed because of a network error", undefined, "network");
  return error;
}

function httpError(response: Response, detail: string): GitHubError {
  const retryAfter = response.headers.get("Retry-After");
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  const reset = Number(response.headers.get("X-RateLimit-Reset")) * 1000;
  const retryAt = retryAfter ? (Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter)) : reset || undefined;
  const rateLimited =
    response.status === 429 ||
    (response.status === 403 && (response.headers.get("X-RateLimit-Remaining") === "0" || retryAfter !== null || /rate limit/iu.test(detail)));
  return new GitHubError(
    detail || `GitHub request failed (${response.status})`,
    response.status,
    undefined,
    Number.isFinite(retryAt) ? retryAt : undefined,
    rateLimited
  );
}

export function normalizeGitHubToken(input: string): string {
  let token = input.trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["‘", "’"]
  ];
  const pair = quotePairs.find(([left, right]) => token.startsWith(left) && token.endsWith(right));
  if (pair && token.length >= 2) token = token.slice(pair[0].length, -pair[1].length).trim();
  token = token.replace(/\s+/gu, "");
  if (token && !/^[\x21-\x7e]+$/.test(token)) {
    throw new GitHubError("GitHub token contains unsupported characters. Paste the token only, without labels or punctuation.");
  }
  return token;
}

export class GistClient {
  private readonly token: string;
  private readonly verifiedReads = new WeakMap<RemoteSnapshot, string>();

  constructor(
    token: string,
    private readonly signal?: AbortSignal
  ) {
    this.token = normalizeGitHubToken(token);
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const method = init?.method?.toUpperCase() ?? "GET";
    const retryableMethod = method === "GET" || method === "PATCH";
    const attempts = retryableMethod ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.signal?.throwIfAborted();
        const timeout = AbortSignal.timeout(15_000);
        const response = await fetch(url, {
          ...init,
          cache: "no-store",
          signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...init?.headers
          }
        });
        const text = await readBoundedText(response, response.ok ? MAX_SNAPSHOT_BYTES * 6 + 1024 * 1024 : 256 * 1024);
        if (!response.ok) {
          let detail = "";
          try {
            detail = (JSON.parse(text) as { message?: string }).message ?? "";
          } catch {
            /* optional API detail */
          }
          if (method === "GET" && response.status >= 500 && attempt + 1 < attempts) continue;
          throw httpError(response, detail);
        }
        return JSON.parse(text) as T;
      } catch (error) {
        this.signal?.throwIfAborted();
        const failure = transportError(error);
        if (retryableMethod && attempt + 1 < attempts && failure instanceof GitHubError && failure.kind) continue;
        throw failure;
      }
    }
    throw new GitHubError("GitHub did not return a response");
  }

  private assertSecretGist(gist: GistResponse): void {
    if (gist.public !== false) {
      throw new GitHubError("Firstlight refuses to sync with a public Gist. Create or select a secret Gist instead.");
    }
  }

  private async getSecretGist(gistId: string): Promise<GistResponse> {
    const gist = await this.request<GistResponse>(`https://api.github.com/gists/${encodeURIComponent(gistId)}`);
    this.assertSecretGist(gist);
    return gist;
  }

  private async readRawFile(rawUrl: string): Promise<string> {
    const parsed = new URL(rawUrl);
    if (parsed.origin !== "https://gist.githubusercontent.com" || parsed.username || parsed.password)
      throw new GitHubError("GitHub returned an unsupported snapshot URL");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.signal?.throwIfAborted();
        const timeout = AbortSignal.timeout(15_000);
        const response = await fetch(rawUrl, {
          cache: "no-store",
          signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
          headers: { Authorization: `Bearer ${this.token}` }
        });
        const text = await readBoundedText(response, MAX_SNAPSHOT_BYTES);
        if (!response.ok) {
          if (response.status >= 500 && attempt === 0) continue;
          throw httpError(response, `Failed to read the complete snapshot (${response.status})`);
        }
        return text;
      } catch (error) {
        this.signal?.throwIfAborted();
        const failure = transportError(error);
        if (attempt === 0 && failure instanceof GitHubError && failure.kind) continue;
        throw failure;
      }
    }
    throw new GitHubError("GitHub did not return the complete snapshot");
  }

  async discover(): Promise<Array<Pick<RemoteSnapshot, "gistId" | "htmlUrl" | "updatedAt">>> {
    const discovered: Array<Pick<RemoteSnapshot, "gistId" | "htmlUrl" | "updatedAt">> = [];
    for (let page = 1; ; page += 1) {
      const gists = await this.request<GistResponse[]>(`https://api.github.com/gists?per_page=100&page=${page}`);
      discovered.push(
        ...gists
          .filter((gist) => gist.public === false && gist.files[SNAPSHOT_FILE_NAME] && gist.description === GIST_DESCRIPTION)
          .map((gist) => ({ gistId: gist.id, htmlUrl: gist.html_url, updatedAt: gist.updated_at }))
      );
      if (gists.length < 100) return discovered;
    }
  }

  async read(gistId: string): Promise<RemoteSnapshot> {
    const gist = await this.getSecretGist(gistId);
    return this.decodeRemote(gist, this.token);
  }

  /** Only a user-requested upload may use this path to replace a validated plaintext snapshot. */
  async readForEncryptionUpgrade(gistId: string): Promise<RemoteSnapshot> {
    const gist = await this.getSecretGist(gistId);
    return this.decodeRemote(gist, this.token, true);
  }

  private async decodeRemote(gist: GistResponse, decryptionToken: string, allowPlaintextNotes = false): Promise<RemoteSnapshot> {
    const file = gist.files[SNAPSHOT_FILE_NAME];
    if (!file) throw new GitHubError(`${SNAPSHOT_FILE_NAME} is missing from the Gist`);
    let content = file.content;
    if (file.truncated || typeof content !== "string") {
      if (!file.raw_url) throw new GitHubError("GitHub did not return a complete snapshot URL");
      content = await this.readRawFile(file.raw_url);
    }
    let decoded: ReturnType<typeof parseSnapshotWithDiagnostics>;
    try {
      decoded = await decodeGistSnapshot(content, decryptionToken, this.signal);
    } catch (error) {
      if (!allowPlaintextNotes || !(error instanceof UnsupportedNotesFormatError)) throw error;
      decoded = parseSnapshotWithDiagnostics(content);
    }
    const remote: RemoteSnapshot = {
      gistId: gist.id,
      htmlUrl: gist.html_url,
      updatedAt: gist.updated_at,
      ...decoded
    };
    this.verifiedReads.set(remote, gist.id);
    return remote;
  }

  /** Requests use the new credential even when the old token has been revoked. */
  async rekey(gistId: string, oldToken?: string, beforeWrite?: () => Promise<void>): Promise<RemoteSnapshot> {
    const gist = await this.getSecretGist(gistId);
    const user = await this.request<{ id: number }>("https://api.github.com/user");
    if (!Number.isSafeInteger(user.id) || user.id !== gist.owner?.id) throw new GitHubError("Token migration is only allowed for your own Gist");
    try {
      // A previous PATCH may have succeeded before its acknowledgement or local commit failed.
      return await this.decodeRemote(gist, this.token);
    } catch (error) {
      if (!(error instanceof NotesDecryptionError)) throw error;
      if (!oldToken) throw new NotesDecryptionError();
    }
    const remote = await this.decodeRemote(gist, normalizeGitHubToken(oldToken));
    await beforeWrite?.();
    return this.update(gistId, remote.snapshot, remote);
  }

  async create(snapshot: Snapshot): Promise<RemoteSnapshot> {
    return this.write(undefined, snapshot);
  }

  async update(gistId: string, snapshot: Snapshot, readForThisOperation?: RemoteSnapshot): Promise<RemoteSnapshot> {
    // Only a read produced by this client can replace the preflight, once.
    const alreadyChecked = readForThisOperation !== undefined && this.verifiedReads.get(readForThisOperation) === gistId;
    if (readForThisOperation) this.verifiedReads.delete(readForThisOperation);
    if (!alreadyChecked) await this.read(gistId);
    return this.write(gistId, snapshot);
  }

  private async findSnapshotByHash(expectedHash: string): Promise<RemoteSnapshot | undefined> {
    const discovered = await this.discover();
    for (const candidate of discovered) {
      const remote = await this.read(candidate.gistId);
      if ((await snapshotHash(remote.snapshot)) === expectedHash) return remote;
    }
    return undefined;
  }

  private async write(gistId: string | undefined, snapshot: Snapshot): Promise<RemoteSnapshot> {
    const canonical = validateSnapshot(snapshot);
    const content = await encodeGistSnapshot(canonical, this.token, this.signal);
    const expectedHash = await snapshotHash(canonical);
    const body: {
      description: string;
      public?: false;
      files: Record<string, { content: string }>;
    } = {
      description: GIST_DESCRIPTION,
      files: { [SNAPSHOT_FILE_NAME]: { content } }
    };
    if (!gistId) body.public = false;
    let gist: GistResponse;
    try {
      gist = await this.request<GistResponse>(gistId ? `https://api.github.com/gists/${encodeURIComponent(gistId)}` : "https://api.github.com/gists", {
        method: gistId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (!gistId && error instanceof GitHubError && error.kind) {
        const recovered = await this.findSnapshotByHash(expectedHash);
        if (recovered) return recovered;
        throw new GitHubError(
          "GitHub may have received the create request, but Firstlight could not confirm the result. The POST was not repeated to avoid creating a duplicate Gist; retry from the app so discovery can run again.",
          undefined,
          error.kind
        );
      }
      throw error;
    }
    this.assertSecretGist(gist);
    // A write response is an acknowledgement, not an independent readback.
    const remote = await this.read(gist.id);
    if ((await snapshotHash(remote.snapshot)) !== expectedHash) {
      throw new GitHubError("GitHub stored a different Firstlight snapshot than the one that was uploaded");
    }
    return remote;
  }
}
