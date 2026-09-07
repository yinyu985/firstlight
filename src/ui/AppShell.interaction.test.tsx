// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { DEFAULT_SETTINGS, type SyncedSettings } from "../shared/model";
import type { AppState } from "../shared/protocol";
import { click, control, input, key, mountUi } from "./testing";

vi.mock("./DynamicBackground", () => ({ DynamicBackground: () => null }));
let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  localStorage.clear();
});

function Harness({ settings = DEFAULT_SETTINGS, open = vi.fn() }: { settings?: SyncedSettings; open?: (url: string) => void }) {
  const [state, setState] = useState<AppState>({
    target: "extension",
    bookmarks: [{ title: "Work", children: [{ title: "Guide", url: "https://guide.test" }] }],
    notes: [],
    settings,
    sync: { phase: "local-only", message: "Local only" },
    tokenConfigured: false,
    openSetupOnLaunch: false
  });
  return <AppShell state={state} onOpenBookmark={open} onSaveSettings={(settings) => setState((current) => ({ ...current, settings }))} />;
}

describe("AppShell interactions", () => {
  it("keeps results clickable with a hidden prompt and icon", async () => {
    const open = vi.fn();
    mounted = await mountUi(
      <Harness open={open} settings={{ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, searchText: "hidden", searchIcon: false } }} />
    );
    const search = control<HTMLInputElement>("Search bookmarks");
    expect(search.placeholder).toBe("");
    await input(search, "Guide");
    const result = document.querySelector<HTMLButtonElement>(".search-row")!;
    expect(result.textContent).toBe("Guide");
    await click(result);
    expect(open).toHaveBeenCalledWith("https://guide.test");
    await input(search, "unmatched");
    expect(document.querySelector(".search-results")?.textContent).toBe("NO RESULTS");
    await key(search, "Escape");
    expect(document.querySelector(".search-results")).toBeNull();
  });

  it("keeps the existing grid accessible and expands nested folders", async () => {
    mounted = await mountUi(<Harness />);
    await click(document.querySelector<HTMLButtonElement>(".bookmark-cell")!);
    expect(document.querySelector(".folder-row")?.textContent).toBe("Guide");
    await click(control("Open settings"));
    expect(document.querySelector<HTMLElement>(".center-stage")?.inert).toBe(true);
    await key(control("Home grid rows"), "ArrowDown");
    await key(document.activeElement as HTMLElement, "End");
    await click(document.activeElement as HTMLElement);
    expect(control("Home grid rows").textContent).toContain("8");
    await key(control("Home grid rows"), "Escape");
    expect(document.querySelector(".settings-drawer")).toBeNull();
    expect(document.querySelector<HTMLElement>(".center-stage")?.inert).not.toBe(true);
  });

  it("isolates Notes and supports creating and editing a note", async () => {
    mounted = await mountUi(<Harness />);
    await click(control("Open note panel"));
    await click(control("Create new note"));
    await input(control<HTMLInputElement>("Note title"), "A note");
    await input(control<HTMLTextAreaElement>("Note content"), "My content");
    expect(document.querySelector(".notes-item-title")?.textContent).toBe("A note");
    const created = [...document.querySelectorAll<HTMLButtonElement>(".notes-sort-row button")].find((button) => button.textContent === "CREATED")!;
    await click(created);
    expect(created.getAttribute("aria-pressed")).toBe("true");
    await key(control("Note content"), "Escape");
    expect(document.querySelector(".notes-window")).toBeNull();
  });
});
