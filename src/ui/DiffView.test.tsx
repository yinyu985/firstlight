// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotFrom, DEFAULT_SETTINGS, type DiffPayload } from "../shared/model";
import { DiffView } from "./DiffView";
import { click, control, key, mountUi } from "./testing";

const editors = vi.hoisted(() => ({ mounted: vi.fn(), destroyed: vi.fn() }));
vi.mock("@codemirror/merge", () => ({
  MergeView: class {
    element = document.createElement("div");
    constructor(config: { parent: HTMLElement; a: { doc: string }; b: { doc: string } }) {
      editors.mounted(config.a.doc, config.b.doc);
      this.element.className = "cm-mergeView";
      config.parent.append(this.element);
    }
    destroy() {
      editors.destroyed();
      this.element.remove();
    }
  }
}));

const payload: DiffPayload = {
  id: "a",
  source: "remote",
  gistId: "g",
  remoteUpdatedAt: "date",
  leftHash: "left",
  rightHash: "right",
  left: snapshotFrom([], DEFAULT_SETTINGS),
  right: snapshotFrom([{ title: "Remote", url: "https://remote.test" }], DEFAULT_SETTINGS)
};
let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  vi.clearAllMocks();
});

describe("snapshot comparison controls", () => {
  it("creates a local comparison and closes immediately on the user's choice", async () => {
    const useRemote = vi.fn();
    mounted = await mountUi(<DiffView diff={payload} onClose={vi.fn()} onUseLeft={vi.fn()} onUseRight={useRemote} />);
    expect(editors.mounted).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("https://remote.test"));
    const button = [...document.querySelectorAll("button")].find((button) => button.textContent === "USE REMOTE")!;
    await click(button);
    expect(useRemote).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("supports Escape without making a snapshot choice", async () => {
    const close = vi.fn();
    const useLocal = vi.fn();
    mounted = await mountUi(<DiffView diff={payload} onClose={close} onUseLeft={useLocal} onUseRight={vi.fn()} />);
    await key(control("Close"), "Escape");
    expect(close).toHaveBeenCalledOnce();
    expect(useLocal).not.toHaveBeenCalled();
  });
});
