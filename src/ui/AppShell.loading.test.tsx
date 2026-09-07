// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, snapshotFrom } from "../shared/model";
import type { AppState } from "../shared/protocol";
import { AppShell } from "./AppShell";
import { click, control, key, mountUi } from "./testing";

vi.mock("./DynamicBackground", () => ({ DynamicBackground: () => null }));
vi.mock("./DiffView", () => new Promise(() => undefined));
let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
});
const state: AppState = {
  target: "extension",
  settings: DEFAULT_SETTINGS,
  bookmarks: [],
  notes: [],
  sync: { phase: "conflict", message: "Choose" },
  tokenConfigured: true,
  openSetupOnLaunch: false,
  diff: {
    id: "waiting",
    source: "remote",
    gistId: "gist",
    remoteUpdatedAt: "date",
    leftHash: "left",
    rightHash: "right",
    left: snapshotFrom([], DEFAULT_SETTINGS),
    right: snapshotFrom([], DEFAULT_SETTINGS)
  }
};
describe("pending Diff download", () => {
  it.each(["Escape", "button"])("can close using %s before the editor chunk arrives", async (method) => {
    const onClose = vi.fn();
    mounted = await mountUi(<AppShell state={state} onCloseDiff={onClose} onOpenBookmark={vi.fn()} />);
    expect(document.querySelector(".loading-dialog")?.textContent).toContain("LOADING DIFF");
    expect(document.activeElement).toBe(control("Close"));
    if (method === "button") await click(control("Close"));
    else await key(control("Close"), "Escape");
    expect(onClose).toHaveBeenCalledExactlyOnceWith("waiting");
    expect(document.querySelector(".loading-dialog")).toBeNull();
  });
});
