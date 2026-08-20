import { useCallback, useEffect, useRef, useState } from "react";
import { GistClient, normalizeGitHubToken } from "../shared/gist";
import { createDataBookmarkId, dataBookmarkViewerUrl, stageDataBookmark } from "../shared/dataBookmarkStore";
import { DEFAULT_SETTINGS, canonicalSettings, snapshotFrom, type Snapshot, type SyncedSettings } from "../shared/model";
import type { AppState } from "../shared/protocol";
import { validateSnapshot } from "../shared/snapshot";
import { isDataBookmarkUrl } from "../shared/url";
import { AppShell } from "./AppShell";

const TOKEN_KEY = "firstlight.online.token";
const SETTINGS_KEY = "firstlight.online.settings";

function readStorage(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function localSettings(): SyncedSettings | undefined {
  const raw = readStorage(SETTINGS_KEY);
  if (!raw) return undefined;
  try {
    return validateSnapshot(snapshotFrom([], JSON.parse(raw))).config;
  } catch {
    removeStorage(SETTINGS_KEY);
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
  const [state, setState] = useState(() => onlineState(undefined, readStorage(TOKEN_KEY)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const connectGeneration = useRef(0);
  const settingsTimer = useRef<number | undefined>(undefined);
  const pendingSettings = useRef<SyncedSettings | undefined>(undefined);

  const connect = useCallback(async (token: string) => {
    const generation = ++connectGeneration.current;
    setBusy(true);
    setError(undefined);
    if (!token.trim()) {
      const stored = removeStorage(TOKEN_KEY);
      if (generation !== connectGeneration.current) return;
      setState(onlineState(undefined, undefined, undefined, "Disconnected"));
      if (!stored) setError("Unable to clear the saved token from this browser");
      setBusy(false);
      return;
    }
    try {
      const normalizedToken = normalizeGitHubToken(token);
      const client = new GistClient(normalizedToken);
      const found = await client.discover();
      if (generation !== connectGeneration.current) return;
      if (!found.length) {
        const stored = writeStorage(TOKEN_KEY, normalizedToken);
        setState(onlineState(undefined, normalizedToken, undefined, "No Firstlight Gist found"));
        if (!stored) setError("Connected, but the token could not be saved locally");
      } else {
        const newest = [...found].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        const remote = await client.read(newest.gistId);
        if (generation !== connectGeneration.current) return;
        const stored = writeStorage(TOKEN_KEY, normalizedToken);
        setState(onlineState(remote.snapshot, normalizedToken, remote.htmlUrl, "Remote snapshot / read only", remote.gistId));
        if (!stored) setError("Connected, but the connection could not be saved locally");
      }
    } catch (cause) {
      if (generation === connectGeneration.current) setError(cause instanceof Error ? cause.message : "Read failed");
    } finally {
      if (generation === connectGeneration.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const token = readStorage(TOKEN_KEY);
    if (token) void connect(token);
    return () => {
      connectGeneration.current += 1;
      if (settingsTimer.current !== undefined) window.clearTimeout(settingsTimer.current);
      const settings = pendingSettings.current;
      if (settings) writeStorage(SETTINGS_KEY, JSON.stringify(settings));
    };
  }, [connect]);

  const saveSettings = (settings: SyncedSettings) => {
    const next = canonicalSettings(settings);
    setState((current) => ({ ...current, settings: next }));
    pendingSettings.current = next;
    if (settingsTimer.current !== undefined) window.clearTimeout(settingsTimer.current);
    settingsTimer.current = window.setTimeout(() => {
      settingsTimer.current = undefined;
      const pending = pendingSettings.current;
      if (!pending) return;
      if (writeStorage(SETTINGS_KEY, JSON.stringify(pending))) {
        if (pendingSettings.current === pending) pendingSettings.current = undefined;
        setError(undefined);
      } else {
        setError("Unable to save settings in this browser");
      }
    }, 120);
  };

  const openBookmark = (url: string) => {
    if (!isDataBookmarkUrl(url)) {
      if (state.settings.openTarget === "current-tab") window.location.assign(url);
      else window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const id = createDataBookmarkId();
    const viewerUrl = dataBookmarkViewerUrl(id, window.location.href);
    if (state.settings.openTarget === "new-tab") window.open(viewerUrl, "_blank", "noopener,noreferrer");
    void stageDataBookmark(id, url)
      .then(() => {
        if (state.settings.openTarget === "current-tab") window.location.assign(viewerUrl);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to open the data bookmark");
      });
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
