// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/model";
import type { AppState, ExtensionRequest } from "../shared/protocol";
import { applyStatePatch, type StatePatch } from "../shared/statePatch";
import { ExtensionApp } from "./ExtensionApp";
import { click, control, input, mountUi } from "./testing";

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
