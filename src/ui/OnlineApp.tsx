import { useEffect, useState } from "react";
import { GistClient, normalizeGitHubToken } from "../shared/gist";
import { DEFAULT_SETTINGS, canonicalSettings, snapshotFrom, type Snapshot, type SyncedSettings } from "../shared/model";
import type { AppState } from "../shared/protocol";
import { validateSnapshot } from "../shared/snapshot";
import { AppShell } from "./AppShell";

const TOKEN_KEY = "firstlight.online.token";
const GIST_KEY = "firstlight.online.gist";
const SETTINGS_KEY = "firstlight.online.settings";

function localSettings(): SyncedSettings | undefined {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return undefined;
  try {
    return validateSnapshot(snapshotFrom([], JSON.parse(raw))).config;
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
    return undefined;
  }
}

function onlineState(snapshot?: Snapshot, token?: string, gistUrl?: string, message = "Read only", gistId?: string): AppState {
  return {
    target: "online",
    bookmarks: snapshot?.bookmarks ?? [],
    notes: snapshot?.notes ?? [],
    settings: localSettings() ?? snapshot?.config ?? DEFAULT_SETTINGS,
    sync: { phase: snapshot ? "synced" : "local-only", message, gistId },
    openSetupOnLaunch: false,
    gistUrl,
    token,
    tokenConfigured: Boolean(token)
  };
}

export function OnlineApp() {
  const [state, setState] = useState(() => onlineState(undefined, localStorage.getItem(TOKEN_KEY) ?? undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const connect = async (token: string, requestedGist?: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const normalizedToken = normalizeGitHubToken(token);
      const client = new GistClient(normalizedToken);
      const found = requestedGist
        ? [{ gistId: requestedGist, htmlUrl: "", updatedAt: "" }]
        : await client.discover();
      if (!found.length) {
        localStorage.setItem(TOKEN_KEY, normalizedToken);
        setState(onlineState(undefined, normalizedToken, undefined, "No Firstlight Gist found"));
      } else {
        const newest = [...found].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        const remote = await client.read(newest.gistId);
        localStorage.setItem(TOKEN_KEY, normalizedToken);
        localStorage.setItem(GIST_KEY, remote.gistId);
        setState(onlineState(remote.snapshot, normalizedToken, remote.htmlUrl, "Remote snapshot / read only", remote.gistId));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Read failed");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) void connect(token);
  }, []);

  const saveSettings = (settings: SyncedSettings) => {
    const next = canonicalSettings(settings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setState((current) => ({ ...current, settings: next }));
  };

  const openBookmark = (url: string) => {
    if (state.settings.openTarget === "current-tab") window.location.assign(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  return <AppShell
    state={state}
    busy={busy}
    error={error}
    onOpenBookmark={openBookmark}
    onSaveSettings={saveSettings}
    onSaveToken={(token) => void connect(token)}
  />;
}
