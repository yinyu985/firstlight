import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncNote, SyncedSettings } from "../shared/model";
import type { AppState, ExtensionRequest, ExtensionResponse } from "../shared/protocol";
import { AppShell } from "./AppShell";

async function request(message: ExtensionRequest): Promise<AppState> {
  const response = await chrome.runtime.sendMessage(message) as ExtensionResponse;
  if (!response.ok || !response.state) throw new Error(response.error ?? "The extension service returned no state");
  return response.state;
}

export function ExtensionApp() {
  const [state, setState] = useState<AppState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const operationPending = useRef(false);
  const pendingSettings = useRef<SyncedSettings | undefined>(undefined);
  const pendingNotes = useRef<SyncNote[] | undefined>(undefined);
  const notesGeneration = useRef(0);
  const settingsTimer = useRef<number | undefined>(undefined);
  const settingsRetryTimer = useRef<number | undefined>(undefined);

  const withOptimisticState = useCallback((next: AppState): AppState => ({
    ...next,
    settings: pendingSettings.current ?? next.settings,
    notes: pendingNotes.current ?? next.notes
  }), []);

  useEffect(() => {
    void request({ type: "GET_STATE" }).then(setState).catch((cause) => setError(cause.message));
    const listener = (message: { type?: string; state?: AppState }) => {
      if (message.type === "STATE_CHANGED" && message.state) {
        setState(withOptimisticState(message.state));
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
  }, [withOptimisticState]);

  const act = useCallback(async (message: ExtensionRequest) => {
    if (operationPending.current) return false;
    operationPending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setState(withOptimisticState(await request(message)));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed");
      return false;
    }
    finally {
      operationPending.current = false;
      setBusy(false);
    }
  }, [withOptimisticState]);

  const saveSettings = useCallback((settings: SyncedSettings) => {
    pendingSettings.current = settings;
    setState((current) => current ? { ...current, settings } : current);
    if (settingsTimer.current !== undefined) window.clearTimeout(settingsTimer.current);
    if (settingsRetryTimer.current !== undefined) window.clearTimeout(settingsRetryTimer.current);
    const submitPendingSettings = () => {
      const submitted = pendingSettings.current;
      if (!submitted) return;
      void request({ type: "SAVE_SETTINGS", settings: submitted }).then((next) => {
        if (pendingSettings.current === submitted) pendingSettings.current = undefined;
        setError(undefined);
        setState(withOptimisticState(next));
      }).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Unable to save settings");
        if (pendingSettings.current === submitted) {
          settingsRetryTimer.current = window.setTimeout(submitPendingSettings, 1_000);
        }
      });
    };
    settingsTimer.current = window.setTimeout(submitPendingSettings, 120);
  }, [withOptimisticState]);

  const saveNotes = useCallback(async (notes: SyncNote[]) => {
    const generation = notesGeneration.current;
    pendingNotes.current = notes;
    try {
      const next = await request({ type: "SAVE_NOTES", notes });
      if (generation !== notesGeneration.current) return;
      if (pendingNotes.current === notes) pendingNotes.current = undefined;
      setError(undefined);
      setState(withOptimisticState(next));
    } catch (cause) {
      if (generation !== notesGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to save notes");
      throw cause;
    }
  }, [withOptimisticState]);

  if (!state) return <div className="boot-screen"><img src="./firstlight-mark.png" alt="Firstlight" />{error && <span>{error}</span>}</div>;

  const openBookmark = (url: string) => {
    if (state.settings.openTarget === "current-tab") void chrome.tabs.update({ url });
    else void chrome.tabs.create({ url });
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
    onUpload={() => void act({ type: "UPLOAD_NOW" })}
    onCompareRemote={() => void act({ type: "COMPARE_REMOTE" })}
    onUseLocal={() => void act({ type: "USE_LOCAL" })}
    onUseRemote={async () => {
      notesGeneration.current += 1;
      pendingNotes.current = undefined;
      if (!await act({ type: "USE_REMOTE" })) throw new Error("Unable to restore the remote snapshot");
    }}
    onCloseDiff={() => void act({ type: "CLEAR_DIFF" })}
    onOpenBookmarkManager={() => void act({ type: "OPEN_BOOKMARK_MANAGER" })}
    onSaveNotes={saveNotes}
  />;
}
