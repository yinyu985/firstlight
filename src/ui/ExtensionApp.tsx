import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeSettings, type SyncNote, type SyncedSettings } from "../shared/model";
import type { AppState, ExtensionRequest, ExtensionResponse } from "../shared/protocol";
import { AppShell } from "./AppShell";

async function request(message: ExtensionRequest): Promise<AppState> {
  const response = await chrome.runtime.sendMessage(message) as ExtensionResponse;
  if (!response.ok || !response.state) throw new Error(response.error ?? "The extension service returned no state");
  return response.state;
}

const SETTINGS_CACHE_KEY = "firstlight.extension.settings-cache";

function readCachedSettings(): SyncedSettings | undefined {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedSettings(settings: SyncedSettings): void {
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // The service worker remains the source of truth when page storage is unavailable.
  }
}

function cachedStartupState(): AppState | undefined {
  const settings = readCachedSettings();
  if (!settings) return undefined;
  return {
    target: "extension",
    bookmarks: [],
    notes: [],
    settings,
    sync: { phase: "local-only", message: "Loading…" },
    tokenConfigured: false,
    openSetupOnLaunch: false
  };
}

export function ExtensionApp() {
  const [state, setState] = useState<AppState | undefined>(cachedStartupState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const operationPending = useRef(false);
  const pendingSettings = useRef<SyncedSettings | undefined>(undefined);
  const pendingNotes = useRef<SyncNote[] | undefined>(undefined);
  const notesGeneration = useRef(0);
  const settingsGeneration = useRef(0);
  const settingsTimer = useRef<number | undefined>(undefined);
  const settingsRetryTimer = useRef<number | undefined>(undefined);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());
  const settingsJobs = useRef(new WeakMap<SyncedSettings, Promise<void>>());
  const submitPendingSettingsRef = useRef<() => Promise<void>>(async () => undefined);

  const withOptimisticState = useCallback((next: AppState): AppState => ({
    ...next,
    settings: pendingSettings.current ?? next.settings,
    notes: pendingNotes.current ?? next.notes
  }), []);
  const acceptState = useCallback((next: AppState) => {
    const optimistic = withOptimisticState(next);
    writeCachedSettings(optimistic.settings);
    setState(optimistic);
  }, [withOptimisticState]);

  useEffect(() => {
    void request({ type: "GET_STATE" }).then(acceptState).catch((cause) => setError(cause.message));
    const listener = (message: { type?: string; state?: AppState }) => {
      if (message.type === "STATE_CHANGED" && message.state) {
        acceptState(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      if (settingsTimer.current !== undefined) window.clearTimeout(settingsTimer.current);
      if (settingsRetryTimer.current !== undefined) window.clearTimeout(settingsRetryTimer.current);
      const submitted = pendingSettings.current;
      if (submitted) void request({ type: "SAVE_SETTINGS", settings: submitted }).catch(() => undefined);
    };
  }, [acceptState]);

  const act = useCallback(async (message: ExtensionRequest) => {
    if (operationPending.current) return false;
    operationPending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      acceptState(await request(message));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed");
      return false;
    }
    finally {
      operationPending.current = false;
      setBusy(false);
    }
  }, [acceptState]);

  const submitPendingSettings = useCallback((): Promise<void> => {
    const submitted = pendingSettings.current;
    if (!submitted) return Promise.resolve();
    const existing = settingsJobs.current.get(submitted);
    if (existing) return existing;

    const generation = settingsGeneration.current;
    const task = settingsQueue.current.then(async () => {
      if (generation !== settingsGeneration.current) return;
      const next = await request({ type: "SAVE_SETTINGS", settings: submitted });
      if (generation !== settingsGeneration.current) return;
      if (pendingSettings.current === submitted) pendingSettings.current = undefined;
      setError(undefined);
      acceptState(next);
    });
    const handled = task.catch((cause) => {
      if (generation === settingsGeneration.current) {
        setError(cause instanceof Error ? cause.message : "Unable to save settings");
        if (pendingSettings.current === submitted && settingsRetryTimer.current === undefined) {
          settingsRetryTimer.current = window.setTimeout(() => {
            settingsRetryTimer.current = undefined;
            void submitPendingSettingsRef.current().catch(() => undefined);
          }, 1_000);
        }
      }
      throw cause;
    });
    settingsQueue.current = handled.catch(() => undefined);
    settingsJobs.current.set(submitted, handled);
    void handled.then(
      () => settingsJobs.current.delete(submitted),
      () => settingsJobs.current.delete(submitted)
    );
    return handled;
  }, [acceptState]);
  submitPendingSettingsRef.current = submitPendingSettings;

  const flushPendingSettings = useCallback(async () => {
    if (settingsTimer.current !== undefined) {
      window.clearTimeout(settingsTimer.current);
      settingsTimer.current = undefined;
    }
    if (settingsRetryTimer.current !== undefined) {
      window.clearTimeout(settingsRetryTimer.current);
      settingsRetryTimer.current = undefined;
    }
    const generation = settingsGeneration.current;
    while (pendingSettings.current && generation === settingsGeneration.current) {
      await submitPendingSettingsRef.current();
    }
    await settingsQueue.current;
  }, []);

  const cancelPendingSettings = useCallback(() => {
    settingsGeneration.current += 1;
    if (settingsTimer.current !== undefined) window.clearTimeout(settingsTimer.current);
    if (settingsRetryTimer.current !== undefined) window.clearTimeout(settingsRetryTimer.current);
    settingsTimer.current = undefined;
    settingsRetryTimer.current = undefined;
    pendingSettings.current = undefined;
  }, []);

  const actAfterSettings = useCallback(async (message: ExtensionRequest) => {
    try {
      await flushPendingSettings();
    } catch {
      return false;
    }
    return act(message);
  }, [act, flushPendingSettings]);

  const saveSettings = useCallback((settings: SyncedSettings) => {
    pendingSettings.current = settings;
    writeCachedSettings(settings);
    setState((current) => current ? { ...current, settings } : current);
    if (settingsTimer.current !== undefined) window.clearTimeout(settingsTimer.current);
    if (settingsRetryTimer.current !== undefined) window.clearTimeout(settingsRetryTimer.current);
    settingsTimer.current = window.setTimeout(() => {
      settingsTimer.current = undefined;
      void submitPendingSettingsRef.current().catch(() => undefined);
    }, 120);
  }, []);

  const saveNotes = useCallback(async (notes: SyncNote[]) => {
    const generation = notesGeneration.current;
    pendingNotes.current = notes;
    try {
      const next = await request({ type: "SAVE_NOTES", notes });
      if (generation !== notesGeneration.current) return;
      if (pendingNotes.current === notes) pendingNotes.current = undefined;
      setError(undefined);
      acceptState(next);
    } catch (cause) {
      if (generation !== notesGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to save notes");
      throw cause;
    }
  }, [acceptState]);

  if (!state) return <div className="boot-screen"><img src="./firstlight-mark.png" alt="Firstlight" />{error && <span>{error}</span>}</div>;

  const openBookmark = (url: string) => {
    const opening = state.settings.openTarget === "current-tab"
      ? chrome.tabs.update({ url })
      : chrome.tabs.create({ url });
    void opening
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to open the data bookmark");
      });
  };

  return <AppShell
    state={state}
    busy={busy}
    error={error}
    openSetupOnLaunch={state.openSetupOnLaunch}
    onOpenBookmark={openBookmark}
    onSaveSettings={saveSettings}
    onImportBookmarks={() => void act({ type: "IMPORT_BOOKMARKS" })}
    onSaveToken={(token) => void act({ type: "SAVE_TOKEN", token })}
    onUpload={() => void actAfterSettings({ type: "UPLOAD_NOW" })}
    onCompareRemote={() => void actAfterSettings({ type: "COMPARE_REMOTE" })}
    onUseLocal={async (diffId) => {
      if (!await actAfterSettings({ type: "USE_LOCAL", diffId })) throw new Error("Unable to upload the local snapshot");
    }}
    onUseRemote={async (diffId) => {
      cancelPendingSettings();
      notesGeneration.current += 1;
      pendingNotes.current = undefined;
      if (!await act({ type: "USE_REMOTE", diffId })) throw new Error("Unable to restore the remote snapshot");
    }}
    onCloseDiff={(diffId) => void act({ type: "CLEAR_DIFF", diffId })}
    onOpenBookmarkManager={() => void act({ type: "OPEN_BOOKMARK_MANAGER" })}
    onSaveNotes={saveNotes}
  />;
}
