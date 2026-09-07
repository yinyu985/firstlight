// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type SyncNote } from "../shared/model";
import type { AppState, ExtensionRequest, ExtensionResponse } from "../shared/protocol";
import type { AppShell } from "./AppShell";
import { ExtensionApp } from "./ExtensionApp";
import { mountUi } from "./testing";

let props: ComponentProps<typeof AppShell>;
vi.mock("./AppShell", () => ({
  AppShell: (value: ComponentProps<typeof AppShell>) => {
    props = value;
    return null;
  }
}));
let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
const time = "2026-08-12T10:00:00.000+08:00";
const notes = (content: string): SyncNote[] => [{ id: "a", name: "Note", content, createtime: time, updatetime: time }];

afterEach(async () => {
  await mounted?.unmount();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function backend() {
  let state: AppState = {
    target: "extension",
    settings: DEFAULT_SETTINGS,
    bookmarks: [],
    notes: notes("Saved"),
    sync: { phase: "local-only", message: "Local only" },
    tokenConfigured: false,
    openSetupOnLaunch: false
  };
  const send = vi.fn(async (request: ExtensionRequest): Promise<ExtensionResponse> => {
    if (request.type === "SAVE_SETTINGS") state = { ...state, settings: request.settings };
    if (request.type === "SAVE_NOTES") state = { ...state, notes: request.notes };
    return { ok: true, state };
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage: send, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
  return { send, getState: () => state };
}

it("blocks edits while cached startup settings are waiting for the real Notes", async () => {
  localStorage.setItem("firstlight.extension.settings-cache", JSON.stringify(DEFAULT_SETTINGS));
  const server = backend();
  let loaded!: (response: ExtensionResponse) => void;
  server.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      })
  );
  mounted = await mountUi(<ExtensionApp />);
  expect(props.localEditsBlocked).toBe(true);
  await act(async () => {
    props.onDraftNotes!(notes("Must not replace saved Notes"));
    props.onSaveSettings!(DEFAULT_SETTINGS);
    await expect(props.onSaveNotes!(notes("Must not save"))).rejects.toMatchObject({ retryable: false });
  });
  expect(server.send).toHaveBeenCalledTimes(1);
  await act(async () => loaded({ ok: true, state: server.getState() }));
  expect(props.localEditsBlocked).toBe(false);
  expect(props.state.notes).toEqual(notes("Saved"));
});

it("persists pending settings before attempting a remote restore, including when restore fails", async () => {
  vi.useFakeTimers();
  const server = backend();
  const normal = server.send.getMockImplementation()!;
  server.send.mockImplementation((request) => (request.type === "USE_REMOTE" ? Promise.resolve({ ok: false, error: "Remote unavailable" }) : normal(request)));
  mounted = await mountUi(<ExtensionApp />);
  await act(async () => props.onSaveSettings!({ ...DEFAULT_SETTINGS, foreground: { ...DEFAULT_SETTINGS.foreground, fontSize: 19 } }));
  await act(async () => {
    await expect(props.onUseRemote!("reviewed-diff")).rejects.toThrow();
  });
  expect(server.send.mock.calls.map(([r]) => r.type)).toEqual(["GET_STATE", "SAVE_SETTINGS", "USE_REMOTE"]);
  expect(server.getState().settings.foreground.fontSize).toBe(19);
  expect(props.error).toBe("Remote unavailable");
  expect(props.localEditsBlocked).toBe(false);
});

it("does not start restore if saving pending settings fails, and retries the settings", async () => {
  vi.useFakeTimers();
  const server = backend();
  mounted = await mountUi(<ExtensionApp />);
  await act(async () => props.onSaveSettings!({ ...DEFAULT_SETTINGS, foreground: { ...DEFAULT_SETTINGS.foreground, fontSize: 18 } }));
  server.send.mockResolvedValueOnce({ ok: false, error: "Temporary disk failure", retryable: true });
  await act(async () => {
    await expect(props.onUseRemote!("diff")).rejects.toThrow("Temporary disk failure");
  });
  expect(server.send.mock.calls.some(([r]) => r.type === "USE_REMOTE")).toBe(false);
  expect(props.state.settings.foreground.fontSize).toBe(18);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(server.getState().settings.foreground.fontSize).toBe(18);
});

it("blocks fresh Notes writes throughout restore and resumes the previous draft only after failure", async () => {
  const server = backend();
  mounted = await mountUi(<ExtensionApp />);
  const draft = notes("Unsaved local draft");
  await act(async () => props.onDraftNotes!(draft));
  let finish!: (response: ExtensionResponse) => void;
  server.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let restoring!: Promise<unknown>;
  await act(async () => {
    restoring = Promise.resolve(props.onUseRemote!("diff")).catch(() => undefined);
  });
  expect(props.localEditsBlocked).toBe(true);
  await act(async () => {
    props.onDraftNotes!(notes("Typed during restore"));
    await expect(props.onSaveNotes!(notes("Typed during restore"))).rejects.toMatchObject({ retryable: false });
  });
  expect(server.send.mock.calls.filter(([r]) => r.type === "SAVE_NOTES")).toHaveLength(0);
  await act(async () => {
    finish({ ok: false, error: "Restore failed" });
    await restoring;
  });
  expect(server.getState().notes).toEqual(draft);
  expect(props.localEditsBlocked).toBe(false);
});

it("does not replay a discarded draft after a successful remote restore", async () => {
  const server = backend();
  mounted = await mountUi(<ExtensionApp />);
  await act(async () => props.onDraftNotes!(notes("Local draft")));
  server.send.mockResolvedValueOnce({ ok: true, state: { ...server.getState(), notes: notes("Remote") } });
  await act(async () => {
    await props.onUseRemote!("diff");
  });
  expect(props.state.notes).toEqual(notes("Remote"));
  expect(server.send.mock.calls.filter(([r]) => r.type === "SAVE_NOTES")).toHaveLength(0);
  expect(localStorage.getItem("firstlight.extension.pending-notes")).toBeNull();
});

it("retains a permanently rejected draft without automatically retrying the same payload", async () => {
  vi.useFakeTimers();
  const server = backend();
  mounted = await mountUi(<ExtensionApp />);
  const draft = notes("Rejected draft");
  server.send.mockResolvedValueOnce({ ok: false, error: "Notes exceed the size limit", retryable: false });
  await act(async () => {
    props.onDraftNotes!(draft);
    await expect(props.onSaveNotes!(draft)).rejects.toMatchObject({ retryable: false });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(server.send.mock.calls.filter(([r]) => r.type === "SAVE_NOTES")).toHaveLength(1);
  expect(localStorage.getItem("firstlight.extension.pending-notes")).toContain("Rejected draft");
  const smaller = notes("Corrected");
  await act(async () => {
    props.onDraftNotes!(smaller);
    await props.onSaveNotes!(smaller);
  });
  expect(server.getState().notes).toEqual(smaller);
});

it("warns before leaving only when an unacknowledged draft cannot be backed up", async () => {
  const server = backend();
  mounted = await mountUi(<ExtensionApp />);
  await act(async () => props.onDraftNotes!(notes("Not yet saved")));
  const backup = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(backup);
  expect(backup.defaultPrevented).toBe(false);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const blocked = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(blocked);
  expect(blocked.defaultPrevented).toBe(true);
  expect(server.getState().notes).toEqual(notes("Saved"));
});
