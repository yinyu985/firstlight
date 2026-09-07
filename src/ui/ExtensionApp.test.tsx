// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/model";
import type { AppState, ExtensionRequest } from "../shared/protocol";
import { applyStatePatch, type StatePatch } from "../shared/statePatch";
import { ExtensionApp } from "./ExtensionApp";
import { click, control, input, key, mountUi } from "./testing";

vi.mock("./DynamicBackground", () => ({ DynamicBackground: () => null }));
let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  localStorage.clear();
  vi.useRealTimers();
});

async function mountExtension() {
  vi.useFakeTimers();
  let backend: AppState = {
    target: "extension",
    settings: DEFAULT_SETTINGS,
    bookmarks: [{ title: "Persisted bookmark", url: "https://bookmark.test" }],
    notes: [],
    sync: { phase: "local-only", message: "Local only" },
    tokenConfigured: false,
    openSetupOnLaunch: false
  };
  const listeners = new Set<(message: { type: string; patch: StatePatch }) => void>();
  const sendMessage = vi.fn(async (message: ExtensionRequest) => {
    if (message.type === "SAVE_SETTINGS") {
      backend = { ...backend, settings: message.settings };
      return { ok: true, patch: { settings: message.settings } };
    }
    if (message.type === "SAVE_NOTES") {
      backend = { ...backend, notes: message.notes };
      return { ok: true, patch: { notes: message.notes } };
    }
    return { ok: true, state: backend };
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (listener: (message: { type: string; patch: StatePatch }) => void) => listeners.add(listener),
        removeListener: (listener: (message: { type: string; patch: StatePatch }) => void) => listeners.delete(listener)
      }
    }
  });
  mounted = await mountUi(<ExtensionApp />);
  return {
    sendMessage,
    getState: () => backend,
    async notify(patch: StatePatch) {
      backend = applyStatePatch(backend, patch);
      await act(async () => {
        for (const listener of listeners) listener({ type: "STATE_CHANGED", patch });
      });
    }
  };
}

describe("extension UI state transport", () => {
  it("keeps first-run setup visible when the worker clears its flag before React renders", async () => {
    const startup: AppState = {
      target: "extension",
      settings: DEFAULT_SETTINGS,
      bookmarks: [],
      notes: [],
      sync: { phase: "local-only", message: "Local only" },
      tokenConfigured: false,
      openSetupOnLaunch: true
    };
    let respond!: (response: { ok: boolean; state: AppState }) => void;
    const response = new Promise<{ ok: boolean; state: AppState }>((resolve) => {
      respond = resolve;
    });
    let notify!: (message: { type: string; patch: StatePatch }) => void;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(() => response),
        onMessage: {
          addListener: (listener: typeof notify) => {
            notify = listener;
          },
          removeListener: vi.fn()
        }
      }
    });
    mounted = await mountUi(<ExtensionApp />);
    // Deliver both messages in one React batch, as can happen on a busy runner.
    await act(async () => {
      respond({ ok: true, state: startup });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      notify({ type: "STATE_CHANGED", patch: { openSetupOnLaunch: false } });
    });
    expect(document.querySelector('.settings-drawer[role="dialog"]')).not.toBeNull();
    await key(document.querySelector<HTMLElement>(".settings-drawer")!, "Escape");
    await act(async () => {
      notify({ type: "STATE_CHANGED", patch: { sync: { phase: "local-only", message: "Local only" } } });
    });
    expect(document.querySelector(".settings-drawer")).toBeNull();
  });

  it("flushes an immediate pagehide and retains one backup until acknowledgement", async () => {
    const backend = await mountExtension();
    await click(control("Open note panel"));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await click(control("Create new note"));
    await input(control<HTMLTextAreaElement>("Note content"), "Before immediate refresh");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(backend.getState().notes?.[0].content).toBe("Before immediate refresh");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(localStorage.getItem("firstlight.extension.pending-notes")).toBeNull();
  });

  it("retries Notes after the Notes window is closed and shows failures outside settings", async () => {
    const backend = await mountExtension();
    await click(control("Open note panel"));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await click(control("Create new note"));
    await input(control<HTMLTextAreaElement>("Note content"), "Keep after closing");
    backend.sendMessage.mockRejectedValueOnce(new Error("Notes storage unavailable"));
    await key(control("Note content"), "Escape");
    expect(document.querySelector(".notes-window")).toBeNull();
    expect(document.querySelector(".settings-drawer")).toBeNull();
    expect(document.querySelector(".sync-toast")?.textContent).toContain("Notes storage unavailable");
    expect(localStorage.getItem("firstlight.extension.pending-notes")).toContain("Keep after closing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(backend.getState().notes?.[0].content).toBe("Keep after closing");
    expect(localStorage.getItem("firstlight.extension.pending-notes")).toBeNull();
  });

  it("replays an unacknowledged page draft on reload", async () => {
    const time = "2026-08-20T17:00:00.000+08:00";
    localStorage.setItem(
      "firstlight.extension.pending-notes",
      JSON.stringify([{ id: "a", name: "Recovered", content: "Saved draft", createtime: time, updatetime: time }])
    );
    const backend = await mountExtension();
    expect(backend.getState().notes?.[0].content).toBe("Saved draft");
    expect(localStorage.getItem("firstlight.extension.pending-notes")).toBeNull();
  });
  it("merges compact settings responses without losing bookmarks and retries a failed save", async () => {
    const backend = await mountExtension();
    await click(control("Open settings"));
    backend.sendMessage.mockRejectedValueOnce(new Error("temporary storage failure"));
    await input(control<HTMLInputElement>("Text size"), "18");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(control<HTMLInputElement>("Text size").value).toBe("18");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("temporary storage failure");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(backend.getState().settings.foreground.fontSize).toBe(18);
    expect(document.querySelector(".bookmark-cell")?.textContent).toContain("Persisted bookmark");
    expect(backend.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "SAVE_SETTINGS", compact: true }));
  });

  it("does not replace unsaved note input with a status-only notification", async () => {
    const backend = await mountExtension();
    await click(control("Open note panel"));
    await click(control("Create new note"));
    await input(control<HTMLTextAreaElement>("Note content"), "Unacknowledged input");
    await backend.notify({ sync: { phase: "uploading", message: "Uploading" } });
    expect(control<HTMLTextAreaElement>("Note content").value).toBe("Unacknowledged input");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(backend.getState().notes?.[0].content).toBe("Unacknowledged input");
  });
});

describe("settings retry regressions", () => {
  it("retries settings after a second edit replaces a scheduled retry", async () => {
    const backend = await mountExtension();
    await click(control("Open settings"));
    backend.sendMessage.mockRejectedValueOnce(new Error("first outage"));
    await input(control<HTMLInputElement>("Text size"), "18");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    backend.sendMessage.mockRejectedValueOnce(new Error("second outage"));
    await input(control<HTMLInputElement>("Text size"), "19");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2150);
    });
    expect(backend.getState().settings.foreground.fontSize).toBe(19);
  });
});
