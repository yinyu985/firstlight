// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnlineApp } from "./OnlineApp";
import { DEFAULT_SETTINGS, snapshotFrom } from "../shared/model";
import { click, control, input, key, mountUi } from "./testing";

vi.mock("./DynamicBackground", () => ({ DynamicBackground: () => null }));
vi.mock("../shared/gist", async () => {
  const actual = await vi.importActual<typeof import("../shared/gist")>("../shared/gist");
  return {
    ...actual,
    GistClient: class {
      constructor(private token: string) {}
      async discover() {
        if (this.token === "offline-token") throw new Error("Network unavailable");
        if (this.token !== "valid-test-token") throw new Error("Bad credentials");
        return [{ gistId: "a", updatedAt: "2026-08-03T02:00:00Z" }];
      }
      async read() {
        return {
          snapshot: snapshotFrom([{ title: "Old account", url: "https://old.test" }], DEFAULT_SETTINGS),
          gistId: "a",
          htmlUrl: "https://gist.github.com/a"
        };
      }
    }
  };
});

let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Online connection state", () => {
  it("retains a remembered credential when startup reconnection fails", async () => {
    localStorage.setItem("firstlight.online.token", "offline-token");
    mounted = await mountUi(<OnlineApp />);
    expect(localStorage.getItem("firstlight.online.token")).toBe("offline-token");
    expect(document.querySelector(".sync-toast")?.textContent).toContain("Network unavailable");
  });

  it("reports repaired local fields outside the settings drawer", async () => {
    localStorage.setItem("firstlight.online.settings", JSON.stringify({ ...DEFAULT_SETTINGS, foreground: { color: "bad", fontSize: 18 } }));
    mounted = await mountUi(<OnlineApp />);
    expect(document.querySelector(".sync-toast")?.textContent).toContain("foreground.color");
  });
  it("reloads a session credential correctly under StrictMode", async () => {
    sessionStorage.setItem("firstlight.online.token", "valid-test-token");
    mounted = await mountUi(
      <StrictMode>
        <OnlineApp />
      </StrictMode>
    );
    expect(document.querySelector(".bookmark-cell")?.textContent).toContain("Old account");
  });
  it.each(["wrong-token", "非 ASCII token"])("clears old account content and credentials when replacement %s fails", async (replacement) => {
    mounted = await mountUi(<OnlineApp />);
    await click(control("Open settings"));
    await input(control<HTMLInputElement>("GitHub token"), "valid-test-token");
    await click(document.querySelector<HTMLButtonElement>(".token-row button")!);
    expect(document.querySelector(".bookmark-cell")?.textContent).toContain("Old account");
    await input(control<HTMLInputElement>("GitHub token"), replacement);
    await click(document.querySelector<HTMLButtonElement>(".token-row button")!);
    expect(document.querySelector(".bookmark-cell")).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(sessionStorage.getItem("firstlight.online.token")).toBeNull();
    await key(control("GitHub token"), "Escape");
  });
});

describe("Online local persistence", () => {
  it("flushes Online settings before immediate pagehide", async () => {
    vi.useFakeTimers();
    mounted = await mountUi(<OnlineApp />);
    await click(control("Open settings"));
    await input(control<HTMLInputElement>("Text size"), "19");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem("firstlight.online.settings")).toContain("19");
  });
  it("keeps a connection error visible after unrelated settings are saved", async () => {
    vi.useFakeTimers();
    mounted = await mountUi(<OnlineApp />);
    await click(control("Open settings"));
    await input(control<HTMLInputElement>("GitHub token"), "offline-token");
    await click(document.querySelector<HTMLButtonElement>(".token-row button")!);
    expect(document.querySelector(".error-card")?.textContent).toContain("Network unavailable");
    await input(control<HTMLInputElement>("Text size"), "19");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    expect(document.querySelector(".error-card")?.textContent).toContain("Network unavailable");
    expect(localStorage.getItem("firstlight.online.settings")).toContain("19");
  });
  it("allows clearing an offline remembered token", async () => {
    localStorage.setItem("firstlight.online.token", "offline-token");
    mounted = await mountUi(<OnlineApp />);
    await click(control("Open settings"));
    await input(control<HTMLInputElement>("GitHub token"), "");
    const button = document.querySelector<HTMLButtonElement>(".token-row button")!;
    expect(button.disabled).toBe(false);
    await click(button);
    expect(localStorage.getItem("firstlight.online.token")).toBeNull();
    expect(sessionStorage.getItem("firstlight.online.token")).toBeNull();
  });
});
