import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./model";
import type { AppState } from "./protocol";
import { applyStatePatch, statePatch } from "./statePatch";

describe("state patches", () => {
  const state: AppState = {
    target: "extension",
    bookmarks: [{ title: "A", url: "data:text/plain,large" }],
    settings: DEFAULT_SETTINGS,
    sync: { phase: "synced", message: "Synced" },
    token: "secret",
    tokenConfigured: true,
    openSetupOnLaunch: false
  };
  it("does not include unchanged content or credentials in a status notification", () => {
    const next: AppState = { ...state, sync: { phase: "uploading", message: "Uploading" } };
    expect(statePatch(state, next)).toEqual({ sync: next.sync });
    expect(applyStatePatch(state, statePatch(state, next))).toEqual(next);
  });
  it("preserves deletions across Chrome's JSON serialization", () => {
    const next = { ...state, token: undefined, tokenConfigured: false };
    const transported = JSON.parse(JSON.stringify(statePatch(state, next)));
    expect(transported.token).toBeNull();
    expect(applyStatePatch(state, transported)).toEqual(next);
  });
});
