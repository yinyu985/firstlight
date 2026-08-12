import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, eastEightTimestamp, snapshotFrom, type Snapshot } from "./model";
import { parseSnapshot, prettySnapshot, snapshotHash, stableStringify, validateSnapshot } from "./snapshot";

describe("stableStringify", () => {
  it("sorts object keys but preserves array order", () => {
    expect(stableStringify({ z: 1, a: [{ b: 2, a: 1 }] }))
      .toBe('{"a":[{"a":1,"b":2}],"z":1}');
  });
});

describe("snapshotHash", () => {
  it("ignores updatedAt and reacts to bookmark order", async () => {
    const first = snapshotFrom([
      { title: "A", url: "https://example.com/a" },
      { title: "B", url: "https://example.com/b" }
    ], DEFAULT_SETTINGS);
    const later: Snapshot = { ...first, updatedAt: "2030-01-01T08:00:00.000+08:00" };
    const reordered: Snapshot = { ...later, bookmarks: [...later.bookmarks].reverse() };
    expect(await snapshotHash(first)).toBe(await snapshotHash(later));
    expect(await snapshotHash(first)).not.toBe(await snapshotHash(reordered));
  });

  it("allows duplicate URLs and folders with the same title", () => {
    expect(() => validateSnapshot(snapshotFrom([
      { title: "Same", url: "https://example.com" },
      { title: "Same", url: "https://example.com" },
      { title: "Folder", children: [] },
      { title: "Folder", children: [] }
    ], DEFAULT_SETTINGS))).not.toThrow();
  });
});

describe("canonical snapshot order", () => {
  it("uses one fixed field order regardless of settings insertion order", async () => {
    const scrambled = {
      features: {
        searchPosition: DEFAULT_SETTINGS.features.searchPosition,
        searchIcon: DEFAULT_SETTINGS.features.searchIcon,
        searchText: DEFAULT_SETTINGS.features.searchText,
        bookmarkDetails: DEFAULT_SETTINGS.features.bookmarkDetails,
        clockSeconds: DEFAULT_SETTINGS.features.clockSeconds,
        hoverStyle: DEFAULT_SETTINGS.features.hoverStyle,
        hoverColor: DEFAULT_SETTINGS.features.hoverColor,
        themeMode: DEFAULT_SETTINGS.features.themeMode
      },
      clockPosition: DEFAULT_SETTINGS.clockPosition,
      layout: {
        bookmarkAlignment: DEFAULT_SETTINGS.layout.bookmarkAlignment,
        columns: DEFAULT_SETTINGS.layout.columns,
        rows: DEFAULT_SETTINGS.layout.rows
      },
      foreground: { fontSize: DEFAULT_SETTINGS.foreground.fontSize, color: DEFAULT_SETTINGS.foreground.color },
      background: { angle: 145, to: "#13242a", from: "#070b12", type: "gradient" as const },
      openTarget: DEFAULT_SETTINGS.openTarget
    };
    const snapshot = snapshotFrom([{ url: "https://example.com", title: "Example" }], scrambled);

    expect(Object.keys(snapshot)).toEqual(["schemaVersion", "updatedAt", "config", "bookmarks", "notes"]);
    expect(Object.keys(snapshot.config)).toEqual(["openTarget", "background", "foreground", "layout", "clockPosition", "features"]);
    expect(Object.keys(snapshot.config.background)).toEqual(["type", "from", "to", "angle"]);
    expect(Object.keys(snapshot.config.foreground)).toEqual(["color", "fontSize"]);
    expect(Object.keys(snapshot.config.layout)).toEqual(["rows", "columns", "bookmarkAlignment"]);
    expect(Object.keys(snapshot.config.features)).toEqual(["searchPosition", "searchIcon", "searchText", "bookmarkDetails", "clockSeconds", "hoverStyle", "hoverColor", "themeMode"]);
    expect(Object.keys(snapshot.bookmarks[0])).toEqual(["title", "url"]);

    const remote = parseSnapshot(JSON.stringify(snapshot));
    expect(await prettySnapshot(remote)).toBe(await prettySnapshot(snapshot));
  });
});

describe("parseSnapshot", () => {
  it("keeps every display setting inside config", () => {
    const parsed = parseSnapshot(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    expect(parsed.config).toEqual(DEFAULT_SETTINGS);
    expect(parsed).not.toHaveProperty("openTarget");
    expect(parsed).not.toHaveProperty("background");
  });

  it("accepts the current dynamic background structure", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
    });
    expect(parseSnapshot(JSON.stringify(snapshot)).config.background).toEqual(snapshot.config.background);
  });

  it("defaults hover style to underline for snapshots saved before the setting existed", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const legacy = JSON.parse(JSON.stringify(snapshot));
    delete legacy.config.features.hoverStyle;
    expect(parseSnapshot(JSON.stringify(legacy)).config.features.hoverStyle).toBe("underline");
  });

  it("defaults hover color for snapshots saved before the setting existed", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const legacy = JSON.parse(JSON.stringify(snapshot));
    delete legacy.config.features.hoverColor;
    expect(parseSnapshot(JSON.stringify(legacy)).config.features.hoverColor).toBe("#59d5b8");
  });

  it("rejects unknown hover styles", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      features: { ...DEFAULT_SETTINGS.features, hoverStyle: "glow" as never }
    });
    expect(() => parseSnapshot(JSON.stringify(snapshot))).toThrow("Feature settings are invalid");
  });

  it("rejects the obsolete flat settings structure", () => {
    const current = snapshotFrom([], DEFAULT_SETTINGS);
    const { config, ...base } = current;
    expect(() => parseSnapshot(JSON.stringify({ ...base, ...config }))).toThrow("Invalid snapshot config");
  });

  it("rejects text sizes below the current minimum", () => {
    const invalid = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      foreground: { ...DEFAULT_SETTINGS.foreground, fontSize: 8 }
    });
    expect(() => parseSnapshot(JSON.stringify(invalid))).toThrow("Invalid foreground settings");
  });

  it("requires the East Eight timestamp offset", () => {
    const invalid = { ...snapshotFrom([], DEFAULT_SETTINGS), updatedAt: "2026-08-11T11:07:34.852Z" };
    expect(() => parseSnapshot(JSON.stringify(invalid))).toThrow("+08:00");
  });

  it("preserves opaque URL schemes without executing or filtering them", () => {
    const urls = ["javascript:alert(1)", "data:text/plain,hello", "file:///tmp/a", "custom:value"];
    const snapshot = snapshotFrom(urls.map((url) => ({ title: url, url })), DEFAULT_SETTINGS);
    expect(parseSnapshot(JSON.stringify(snapshot)).bookmarks.map((item) => item.url)).toEqual(urls);
  });

  it("rejects structurally invalid nodes", () => {
    const invalid = { ...snapshotFrom([], DEFAULT_SETTINGS), bookmarks: [{ title: "bad", url: "https://x", children: [] }] };
    expect(() => validateSnapshot(invalid)).toThrow("must be a link or a folder");
  });

  it("rejects duplicate note ids", () => {
    const note = {
      id: "same-id",
      name: "A",
      content: "",
      createtime: "2026-08-12T10:00:00.000+08:00",
      updatetime: "2026-08-12T10:00:00.000+08:00"
    };
    const invalid = { ...snapshotFrom([], DEFAULT_SETTINGS), notes: [note, { ...note, name: "B" }] };
    expect(() => validateSnapshot(invalid)).toThrow("Duplicate note id");
  });

  it("keeps an empty-string URL as a bookmark in the diff projection", async () => {
    const projected = await prettySnapshot(snapshotFrom([{ title: "Empty URL", url: "" }], DEFAULT_SETTINGS));
    expect(projected).toContain('"url": ""');
    expect(projected).not.toContain('"children"');
  });
});

describe("eastEightTimestamp", () => {
  it("formats instants with an explicit +08:00 offset", () => {
    expect(eastEightTimestamp(new Date("2026-08-11T11:07:34.852Z"))).toBe("2026-08-11T19:07:34.852+08:00");
  });
});
