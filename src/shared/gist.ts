import {
  GIST_DESCRIPTION,
  SNAPSHOT_FILE_NAME,
  type Snapshot
} from "./model";
import { SnapshotValidationError, parseSnapshot, serializeSnapshot, snapshotHash, validateSnapshot } from "./snapshot";

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
}

export interface RemoteSnapshot {
  gistId: string;
  htmlUrl: string;
  updatedAt: string;
  snapshot: Snapshot;
}

type GitHubFailureKind = "timeout" | "interrupted" | "network";

export class GitHubError extends Error {
  constructor(message: string, readonly status?: number, readonly kind?: GitHubFailureKind) {
    super(message);
    this.name = "GitHubError";
  }
}

export function normalizeGitHubToken(input: string): string {
  let token = input.trim();
  const quotePairs: Array<[string, string]> = [["\"", "\""], ["'", "'"], ["`", "`"], ["“", "”"], ["‘", "’"]];
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

  constructor(token: string) {
    this.token = normalizeGitHubToken(token);
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const method = init?.method?.toUpperCase() ?? "GET";
    const retryableMethod = method === "GET" || method === "PATCH";
    const attempts = retryableMethod ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          cache: "no-store",
          signal: init?.signal ?? AbortSignal.timeout(15_000),
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...init?.headers
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const timedOut = (error instanceof DOMException && error.name === "TimeoutError") || /timed?\s*out|timeout/iu.test(message);
        const interrupted = (error instanceof DOMException && error.name === "AbortError") || /abort|interrupt/iu.test(message);
        const networkFailure = error instanceof TypeError;
        if (retryableMethod && attempt + 1 < attempts && (timedOut || interrupted || networkFailure)) continue;
        if (timedOut) throw new GitHubError("GitHub request timed out", undefined, "timeout");
        if (interrupted) throw new GitHubError("GitHub request was interrupted by Chrome. Please retry.", undefined, "interrupted");
        if (networkFailure) throw new GitHubError("GitHub request failed because of a network error", undefined, "network");
        throw error;
      }
      if (!response.ok) {
        if (method === "GET" && response.status >= 500 && attempt + 1 < attempts) continue;
        let detail = "";
        try { detail = (await response.json() as { message?: string }).message ?? ""; } catch { /* noop */ }
        throw new GitHubError(detail || `GitHub request failed (${response.status})`, response.status);
      }
      return response.json() as Promise<T>;
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(rawUrl, {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${this.token}` }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const timedOut = (error instanceof DOMException && error.name === "TimeoutError") || /timed?\s*out|timeout/iu.test(message);
        const interrupted = (error instanceof DOMException && error.name === "AbortError") || /abort|interrupt/iu.test(message);
        const networkFailure = error instanceof TypeError;
        if (attempt === 0 && (timedOut || interrupted || networkFailure)) continue;
        if (timedOut) throw new GitHubError("GitHub request timed out");
        if (interrupted) throw new GitHubError("GitHub request was interrupted by Chrome. Please retry.");
        if (networkFailure) throw new GitHubError("GitHub request failed because of a network error");
        throw error;
      }
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
        throw new GitHubError(`Failed to read the complete snapshot (${response.status})`, response.status);
      }
      return response.text();
    }
    throw new GitHubError("GitHub did not return the complete snapshot");
  }

  async discover(): Promise<Array<Pick<RemoteSnapshot, "gistId" | "htmlUrl" | "updatedAt">>> {
    const discovered: Array<Pick<RemoteSnapshot, "gistId" | "htmlUrl" | "updatedAt">> = [];
    for (let page = 1; ; page += 1) {
      const gists = await this.request<GistResponse[]>(`https://api.github.com/gists?per_page=100&page=${page}`);
      discovered.push(...gists
        .filter((gist) => gist.public === false && gist.files[SNAPSHOT_FILE_NAME] && gist.description === GIST_DESCRIPTION)
        .map((gist) => ({ gistId: gist.id, htmlUrl: gist.html_url, updatedAt: gist.updated_at })));
      if (gists.length < 100) return discovered;
    }
  }

  async read(gistId: string): Promise<RemoteSnapshot> {
    const gist = await this.getSecretGist(gistId);
    const file = gist.files[SNAPSHOT_FILE_NAME];
    if (!file) throw new GitHubError(`${SNAPSHOT_FILE_NAME} is missing from the Gist`);
    let content = file.content;
    if (file.truncated || typeof content !== "string") {
      if (!file.raw_url) throw new GitHubError("GitHub did not return a complete snapshot URL");
      content = await this.readRawFile(file.raw_url);
    }
    return {
      gistId: gist.id,
      htmlUrl: gist.html_url,
      updatedAt: gist.updated_at,
      snapshot: parseSnapshot(content)
    };
  }

  async create(snapshot: Snapshot): Promise<RemoteSnapshot> {
    return this.write(undefined, snapshot);
  }

  async update(gistId: string, snapshot: Snapshot): Promise<RemoteSnapshot> {
    await this.getSecretGist(gistId);
    return this.write(gistId, snapshot);
  }

  private async findSnapshotByHash(expectedHash: string): Promise<RemoteSnapshot | undefined> {
    const discovered = await this.discover();
    for (const candidate of discovered) {
      const remote = await this.read(candidate.gistId);
      if (await snapshotHash(remote.snapshot) === expectedHash) return remote;
    }
    return undefined;
  }

  private async write(gistId: string | undefined, snapshot: Snapshot): Promise<RemoteSnapshot> {
    const canonical = validateSnapshot(snapshot);
    const content = serializeSnapshot(canonical);
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
      gist = await this.request<GistResponse>(
        gistId ? `https://api.github.com/gists/${encodeURIComponent(gistId)}` : "https://api.github.com/gists",
        {
          method: gistId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );
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
    const file = gist.files[SNAPSHOT_FILE_NAME];
    let remote: RemoteSnapshot;
    let independentlyRead = false;
    if (file && !file.truncated && typeof file.content === "string") {
      try {
        remote = {
          gistId: gist.id,
          htmlUrl: gist.html_url,
          updatedAt: gist.updated_at,
          snapshot: parseSnapshot(file.content)
        };
      } catch (error) {
        if (!(error instanceof SnapshotValidationError)) throw error;
        remote = await this.read(gist.id);
        independentlyRead = true;
      }
    } else {
      remote = await this.read(gist.id);
      independentlyRead = true;
    }
    if (await snapshotHash(remote.snapshot) === expectedHash) return remote;
    if (!independentlyRead) remote = await this.read(gist.id);
    if (await snapshotHash(remote.snapshot) !== expectedHash) {
      throw new GitHubError("GitHub stored a different Firstlight snapshot than the one that was uploaded");
    }
    return remote;
  }
}
