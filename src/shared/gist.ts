import {
  GIST_DESCRIPTION,
  SNAPSHOT_FILE_NAME,
  canonicalSnapshot,
  type Snapshot
} from "./model";
import { parseSnapshot } from "./snapshot";

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
  files: Record<string, GistFile>;
}

export interface RemoteSnapshot {
  gistId: string;
  htmlUrl: string;
  updatedAt: string;
  snapshot: Snapshot;
}

export class GitHubError extends Error {
  constructor(message: string, readonly status?: number) {
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
    let response: Response | undefined;
    const method = init?.method?.toUpperCase() ?? "GET";
    const attempts = method === "GET" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
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
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const timedOut = (error instanceof DOMException && error.name === "TimeoutError") || /timed?\s*out|timeout/iu.test(message);
        if (timedOut) throw new GitHubError("GitHub request timed out");
        const interrupted = (error instanceof DOMException && error.name === "AbortError") || /abort|interrupt/iu.test(message);
        if (interrupted && attempt + 1 < attempts) continue;
        if (interrupted) throw new GitHubError("GitHub request was interrupted by Chrome. Please retry.");
        throw error;
      }
    }
    if (!response) throw new GitHubError("GitHub did not return a response");
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json() as { message?: string }).message ?? ""; } catch { /* noop */ }
      throw new GitHubError(detail || `GitHub request failed (${response.status})`, response.status);
    }
    return response.json() as Promise<T>;
  }

  async discover(): Promise<Array<Pick<RemoteSnapshot, "gistId" | "htmlUrl" | "updatedAt">>> {
    const gists = await this.request<GistResponse[]>("https://api.github.com/gists?per_page=100");
    return gists
      .filter((gist) => gist.files[SNAPSHOT_FILE_NAME] && gist.description === GIST_DESCRIPTION)
      .map((gist) => ({ gistId: gist.id, htmlUrl: gist.html_url, updatedAt: gist.updated_at }));
  }

  async read(gistId: string): Promise<RemoteSnapshot> {
    const gist = await this.request<GistResponse>(`https://api.github.com/gists/${encodeURIComponent(gistId)}`);
    const file = gist.files[SNAPSHOT_FILE_NAME];
    if (!file) throw new GitHubError(`${SNAPSHOT_FILE_NAME} is missing from the Gist`);
    let content = file.content;
    if (file.truncated || typeof content !== "string") {
      if (!file.raw_url) throw new GitHubError("GitHub did not return a complete snapshot URL");
      let raw: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          raw = await fetch(file.raw_url, {
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
            headers: { Authorization: `Bearer ${this.token}` }
          });
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          const timedOut = (error instanceof DOMException && error.name === "TimeoutError") || /timed?\s*out|timeout/iu.test(message);
          if (timedOut) throw new GitHubError("GitHub request timed out");
          const interrupted = (error instanceof DOMException && error.name === "AbortError") || /abort|interrupt/iu.test(message);
          if (interrupted && attempt === 0) continue;
          if (interrupted) throw new GitHubError("GitHub request was interrupted by Chrome. Please retry.");
          throw error;
        }
      }
      if (!raw) throw new GitHubError("GitHub did not return the complete snapshot");
      if (!raw.ok) throw new GitHubError(`Failed to read the complete snapshot (${raw.status})`, raw.status);
      content = await raw.text();
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
    return this.write(gistId, snapshot);
  }

  private async write(gistId: string | undefined, snapshot: Snapshot): Promise<RemoteSnapshot> {
    const canonical = canonicalSnapshot(snapshot);
    const content = JSON.stringify(canonical, null, 2);
    if (new TextEncoder().encode(content).byteLength > 10 * 1024 * 1024) throw new GitHubError("firstlight.json exceeds the 10 MiB API limit");
    const gist = await this.request<GistResponse>(
      gistId ? `https://api.github.com/gists/${encodeURIComponent(gistId)}` : "https://api.github.com/gists",
      {
        method: gistId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          public: false,
          files: { [SNAPSHOT_FILE_NAME]: { content } }
        })
      }
    );
    const file = gist.files[SNAPSHOT_FILE_NAME];
    if (file && !file.truncated && typeof file.content === "string") {
      return {
        gistId: gist.id,
        htmlUrl: gist.html_url,
        updatedAt: gist.updated_at,
        snapshot: parseSnapshot(file.content)
      };
    }
    return this.read(gist.id);
  }
}
