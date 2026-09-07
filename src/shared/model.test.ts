import { describe, expect, it } from "vitest";
import { createDiffId, DEFAULT_SETTINGS, normalizeSettings, snapshotFrom } from "./model";
import { inspectSettings, validateSnapshot } from "./snapshot";

describe("home grid bounds", () => {
  it("accepts eight rows and columns in both local settings and snapshots", () => {
    const settings = { ...DEFAULT_SETTINGS, layout: { ...DEFAULT_SETTINGS.layout, rows: 8, columns: 8 } };
    expect(normalizeSettings(settings).layout).toEqual(settings.layout);
    expect(validateSnapshot(snapshotFrom([], settings)).config.layout).toEqual(settings.layout);
  });
  it.each([9, 10])("repairs unsupported grid size %i using the existing default-field policy", (size) => {
    const settings = { ...DEFAULT_SETTINGS, layout: { ...DEFAULT_SETTINGS.layout, rows: size, columns: size } };
    const inspected = inspectSettings(settings);
    expect(inspected.settings.layout).toEqual(DEFAULT_SETTINGS.layout);
    expect(inspected.fields).toEqual(expect.arrayContaining(["layout.rows", "layout.columns"]));
    const snapshot = { ...snapshotFrom([], DEFAULT_SETTINGS), config: settings };
    expect(validateSnapshot(snapshot).config.layout).toEqual(DEFAULT_SETTINGS.layout);
  });
});

describe("createDiffId", () => {
  it("is stable for the same semantic hashes and remote revision", () => {
    expect(createDiffId("remote", "left", "right", "revision")).toBe(createDiffId("remote", "left", "right", "revision"));
  });

  it("changes when either side or the remote revision changes", () => {
    const id = createDiffId("remote", "left", "right", "revision");
    expect(createDiffId("remote", "new-left", "right", "revision")).not.toBe(id);
    expect(createDiffId("remote", "left", "new-right", "revision")).not.toBe(id);
    expect(createDiffId("remote", "left", "right", "new-revision")).not.toBe(id);
  });
});
