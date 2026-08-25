import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MAX_SNAPSHOT_BYTES, eastEightTimestamp, snapshotFrom, type SyncedSettings, type Snapshot } from "./model";
import { DYNAMIC_EFFECT_DEFINITIONS, isDynamicEffect, isDynamicEffectInput, normalizeDynamicEffect, type DynamicEffectParameterDefinition, type DynamicSpeedSpec, type DynamicEffectDefinition } from "./dynamicEffects";
import { parseSnapshot, prettySnapshot, serializeSnapshot, snapshotBytes, snapshotHash, stableStringify, validateSnapshot } from "./snapshot";

type RangeParameter = Extract<DynamicEffectParameterDefinition, { kind: "range" }>;

function asRange(parameter: DynamicEffectParameterDefinition): parameter is RangeParameter {
  return parameter.kind === "range";
}

function findNumericRange(definition: DynamicEffectDefinition, key: string): RangeParameter {
  const parameter = definition.parameters.find(
    (candidate): candidate is RangeParameter => candidate.kind === "range" && candidate.key === key
  );
  if (!parameter) throw new Error(`Missing range parameter "${key}" on ${definition.id}`);
  return parameter;
}

function ensureInRange(spec: DynamicSpeedSpec): void;
function ensureInRange(parameter: RangeParameter): void;
function ensureInRange(spec: DynamicSpeedSpec | RangeParameter): void {
  expect(Number.isFinite(spec.min)).toBe(true);
  expect(Number.isFinite(spec.max)).toBe(true);
  expect(Number.isFinite(spec.step)).toBe(true);
  expect(Number.isFinite(spec.defaultValue)).toBe(true);
  expect(spec.max).toBeGreaterThan(spec.min);
  expect(spec.step).toBeGreaterThan(0);
  expect(spec.defaultValue).toBeGreaterThanOrEqual(spec.min);
  expect(spec.defaultValue).toBeLessThanOrEqual(spec.max);
}

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
        themeColor: DEFAULT_SETTINGS.features.themeColor,
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

    expect(Object.keys(snapshot)).toEqual(["schemaVersion", "settingsVersion", "updatedAt", "config", "bookmarks", "notes"]);
    expect(Object.keys(snapshot.config)).toEqual(["openTarget", "background", "dynamicEffectProfiles", "foreground", "layout", "clockPosition", "features"]);
    expect(Object.keys(snapshot.config.background)).toEqual(["type", "from", "to", "angle"]);
    expect(Object.keys(snapshot.config.foreground)).toEqual(["color", "fontSize"]);
    expect(Object.keys(snapshot.config.layout)).toEqual(["rows", "columns", "bookmarkAlignment"]);
    expect(Object.keys(snapshot.config.features)).toEqual(["searchPosition", "searchIcon", "searchText", "bookmarkDetails", "clockSeconds", "hoverStyle", "themeColor", "themeMode"]);
    expect(Object.keys(snapshot.bookmarks[0])).toEqual(["title", "url"]);

    const remote = parseSnapshot(JSON.stringify(snapshot));
    expect(await prettySnapshot(remote)).toBe(await prettySnapshot(snapshot));
  });
});

describe("parseSnapshot", () => {
  it("preserves and normalizes dynamic effect profiles across serialization", () => {
    const settings: SyncedSettings = {
      ...DEFAULT_SETTINGS,
      background: {
        type: "dynamic",
        effect: "flow",
        from: "#112233",
        to: "#223344",
        angle: 10,
        speed: 12,
        parameters: { dotSize: 4, gap: 45, proximity: 77, shockRadius: 140, resistance: 990, returnDuration: 2.25 }
      },
      dynamicEffectProfiles: {
        neuroNoise: {
          from: "#223344",
          to: "#334455",
          angle: 33,
          speed: 14,
          parameters: {
            colorFront: "#abc123",
            colorMid: "#def456",
            colorBack: "#fedcba",
            brightness: 0.35,
            contrast: 0.75,
            scale: 1.8,
            rotation: 12,
            speed: 7
          }
        }
      }
    };
    const saved = snapshotFrom([], settings);
    const legacySnapshot = JSON.parse(JSON.stringify(saved)) as {
      config: { dynamicEffectProfiles: Record<string, unknown> };
    };
    legacySnapshot.config.dynamicEffectProfiles = {
      ...legacySnapshot.config.dynamicEffectProfiles,
      mesh: {
        from: "#778899",
        to: "#99aabb",
        angle: 180,
        speed: 17,
        parameters: {}
      },
      snow: {
        from: "#445566",
        to: "#556677",
        angle: 44,
        speed: 18,
        parameters: {}
      }
    };
    const parsed = parseSnapshot(JSON.stringify(legacySnapshot));
    const flowProfile = parsed.config.dynamicEffectProfiles?.flow;

    expect(flowProfile).toBeDefined();
    expect(flowProfile).toEqual({
      from: "#112233",
      to: "#223344",
      angle: 10,
      speed: 12,
      parameters: {}
    });
    expect(parsed.config.dynamicEffectProfiles?.neuroNoise).toMatchObject({
      from: "#223344",
      to: "#334455",
      angle: 33,
      speed: 4,
      parameters: {
        colorFront: "#abc123",
        colorMid: "#def456",
        colorBack: "#fedcba",
        brightness: 0.35,
        contrast: 0.75,
        scale: 1.8,
        rotation: 12
      }
    });
    expect(parsed.config.dynamicEffectProfiles).not.toHaveProperty("snow");
    if (!flowProfile) throw new Error("Flow profile missing");
    expect(flowProfile.parameters).toEqual({});
    expect(parsed.config.dynamicEffectProfiles?.cells).toMatchObject({
      from: "#778899",
      to: "#99aabb",
      angle: 180,
      speed: 17,
      parameters: { wallThickness: 1 }
    });
  });

  it("migrates legacy ferrofluid background profile to flow", () => {
    const normalizedSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "liquidChrome", from: "#102030", to: "#304050", angle: 145, speed: 999, parameters: {} }
    }))) as unknown as { config: { dynamicEffectProfiles: unknown } };
    normalizedSnapshot.config.dynamicEffectProfiles = {
      ferrofluid: {
        from: "#102030",
        to: "#304050",
        angle: 10,
        speed: 14,
        parameters: { color3: "#badvalue", scale: "x", mouseInteraction: "invalid", turbulence: -5 }
      }
    };
    const normalized = parseSnapshot(JSON.stringify(normalizedSnapshot));
    const currentBackground = normalized.config.background;
    if (currentBackground.type !== "dynamic") throw new Error("Expected dynamic background");
    const flowProfile = normalized.config.dynamicEffectProfiles?.flow;
    if (!flowProfile) throw new Error("Expected migrated flow profile");

    expect(currentBackground.speed).toBe(2);
    expect(flowProfile.speed).toBe(14);
    expect(flowProfile.parameters).toEqual({});
    expect(normalized.config.dynamicEffectProfiles).not.toHaveProperty("ferrofluid");
  });

  it("normalizes renderer-used parameters that were previously under-modeled", () => {
    const settingsByEffect: Record<string, SyncedSettings> = {
      liquidChrome: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "liquidChrome",
          from: "#102030",
          to: "#304050",
          angle: 145,
          speed: 1,
          parameters: {}
        }
      },
      dotGrid: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "dotGrid",
          from: "#102030",
          to: "#304050",
          angle: 145,
          speed: 1,
          parameters: {}
        }
      }
    };

    const liquidChromeSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.liquidChrome))) as { config: { background: { parameters: Record<string, unknown> } } };
    liquidChromeSnapshot.config.background.parameters.color3 = "#fefefe";
    liquidChromeSnapshot.config.background.parameters.interactive = false;
    liquidChromeSnapshot.config.background.parameters.brightness = 1.4;
    liquidChromeSnapshot.config.background.parameters.contrast = 2;
    liquidChromeSnapshot.config.background.parameters.lighting = 0.2;
    const parsedLiquid = parseSnapshot(JSON.stringify(liquidChromeSnapshot));

    const dotGridSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.dotGrid))) as { config: { background: { parameters: Record<string, unknown> } } };
    const parsedDotGrid = parseSnapshot(JSON.stringify(dotGridSnapshot));

    expect(parsedLiquid.config.background).toMatchObject({
      type: "dynamic",
      parameters: { mouseInteraction: false, color3: "#fefefe", brightness: 1.4, contrast: 2, lighting: 0.2 }
    });
    expect(parsedDotGrid.config.background).toMatchObject({
      type: "dynamic",
      parameters: { dotSize: 16, gap: 32, proximity: 150, speedTrigger: 100, maxSpeed: 5000 }
    });
  });

  it("keeps canonical dynamic effect profile IDs when alias IDs are also present", () => {
    const legacy = JSON.parse(JSON.stringify(snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: {
        type: "dynamic",
        effect: "cells",
        from: "#102030",
        to: "#304050",
        angle: 145,
        speed: 10
      }
    }))) as { config: { dynamicEffectProfiles: Record<string, unknown> } };
    legacy.config.dynamicEffectProfiles = {
      flow: {
        from: "#111111",
        to: "#222222",
        angle: 10,
        speed: 14,
        parameters: {}
      },
      ferrofluid: {
        from: "#999999",
        to: "#888888",
        angle: 180,
        speed: 12,
        parameters: {}
      }
    };

    const parsed = parseSnapshot(JSON.stringify(legacy));
    expect(parsed.config.dynamicEffectProfiles?.flow).toMatchObject({
      from: "#111111",
      to: "#222222",
      angle: 10,
      speed: 14
    });
  });

  it("accepts the current dynamic background structure", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "cells", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
    });
    expect(parseSnapshot(JSON.stringify(snapshot)).config.background).toEqual(snapshot.config.background);
  });

  it("defaults legacy dynamic backgrounds to flow", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "flow", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
    });
    const legacy = JSON.parse(JSON.stringify(snapshot));
    delete legacy.config.background.effect;
    expect(parseSnapshot(JSON.stringify(legacy)).config.background).toEqual(snapshot.config.background);
  });

  it("migrates removed dynamic effects", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "flow", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
    });
    const legacyFerrofluid = JSON.parse(JSON.stringify(snapshot));
    legacyFerrofluid.config.background.effect = "ferrofluid";
    expect(parseSnapshot(JSON.stringify(legacyFerrofluid)).config.background).toMatchObject({ effect: "flow" });

    const legacyMesh = JSON.parse(JSON.stringify(snapshot));
    legacyMesh.config.background.effect = "mesh";
    expect(parseSnapshot(JSON.stringify(legacyMesh)).config.background).toMatchObject({ effect: "cells" });

    const legacyGrid = JSON.parse(JSON.stringify(snapshot));
    legacyGrid.config.background.effect = "grid";
    expect(parseSnapshot(JSON.stringify(legacyGrid)).config.background).toMatchObject({ effect: "flow" });

    for (const effect of ["particles", "dither", "rings", "aurora", "snow", "topography", "webThreads", "moltenMetal", "iridescence", "balatro"]) {
      const removed = JSON.parse(JSON.stringify(snapshot));
      removed.config.background.effect = effect;
      expect(parseSnapshot(JSON.stringify(removed)).config.background).toMatchObject({ effect: "flow" });
    }
  });

  it("keeps every display setting inside config", () => {
    const parsed = parseSnapshot(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    expect(parsed.config).toEqual({
      ...DEFAULT_SETTINGS,
      dynamicEffectProfiles: {}
    });
    expect(parsed).not.toHaveProperty("openTarget");
    expect(parsed).not.toHaveProperty("background");
  });

  it("defaults hover style to underline for snapshots saved before the setting existed", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const legacy = JSON.parse(JSON.stringify(snapshot));
    delete legacy.config.features.hoverStyle;
    expect(parseSnapshot(JSON.stringify(legacy)).config.features.hoverStyle).toBe("underline");
  });

  it("restores the default theme color when the field is missing", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const legacy = JSON.parse(JSON.stringify(snapshot));
    delete legacy.config.features.themeColor;
    expect(parseSnapshot(JSON.stringify(legacy)).config.features.themeColor).toBe(DEFAULT_SETTINGS.features.themeColor);
  });

  it("drops unsupported feature fields instead of blocking the snapshot", () => {
    const snapshot = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    snapshot.config.features.futureToggle = true;
    expect(parseSnapshot(JSON.stringify(snapshot)).config.features).not.toHaveProperty("futureToggle");
  });

  it("replaces invalid searchText values instead of migrating old meanings", () => {
    const snapshot = parseSnapshot(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    const hiddenLegacy = JSON.parse(JSON.stringify(snapshot));
    hiddenLegacy.config.features.searchText = false;
    expect(parseSnapshot(JSON.stringify(hiddenLegacy)).config.features.searchText).toBe(DEFAULT_SETTINGS.features.searchText);

    const leftLegacy = JSON.parse(JSON.stringify(snapshot));
    leftLegacy.config.features.searchText = true;
    expect(parseSnapshot(JSON.stringify(leftLegacy)).config.features.searchText).toBe("left");
  });

  it("replaces unknown hover styles with the current default", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      features: { ...DEFAULT_SETTINGS.features, hoverStyle: "glow" as never }
    });
    expect(parseSnapshot(JSON.stringify(snapshot)).config.features.hoverStyle).toBe(DEFAULT_SETTINGS.features.hoverStyle);
  });

  it("rebuilds a missing config without touching snapshot content", () => {
    const current = snapshotFrom([], DEFAULT_SETTINGS);
    const { config, ...base } = current;
    expect(parseSnapshot(JSON.stringify({ ...base, ...config })).config).toEqual({
      ...DEFAULT_SETTINGS,
      dynamicEffectProfiles: {}
    });
  });

  it("restores the default for text sizes below the current minimum", () => {
    const invalid = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      foreground: { ...DEFAULT_SETTINGS.foreground, fontSize: 8 }
    });
    expect(parseSnapshot(JSON.stringify(invalid)).config.foreground.fontSize).toBe(DEFAULT_SETTINGS.foreground.fontSize);
  });

  it("rejects settings produced by a newer client", () => {
    const future = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    future.settingsVersion += 1;
    expect(() => parseSnapshot(JSON.stringify(future))).toThrow("newer Firstlight version");
  });

  it("upgrades schema 1 snapshots into the current canonical shape", () => {
    const legacy = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    legacy.schemaVersion = 1;
    delete legacy.settingsVersion;
    legacy.config.features.unknownSetting = true;
    const parsed = parseSnapshot(JSON.stringify(legacy));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.settingsVersion).toBe(1);
    expect(parsed.config.features).not.toHaveProperty("unknownSetting");
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

  it("rejects unsupported fields in otherwise valid notes", () => {
    const note = {
      id: "note-id",
      name: "A",
      content: "",
      createtime: "2026-08-12T10:00:00.000+08:00",
      updatetime: "2026-08-12T10:00:00.000+08:00",
      futureField: true
    };
    expect(() => validateSnapshot({ ...snapshotFrom([], DEFAULT_SETTINGS), notes: [note] })).toThrow("unsupported fields");
  });

  it("keeps missing notes as a legacy default but rejects a present malformed value", () => {
    const legacy = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    delete legacy.notes;
    expect(parseSnapshot(JSON.stringify(legacy)).notes).toEqual([]);

    for (const notes of [{}, "invalid", 1, null]) {
      expect(() => parseSnapshot(JSON.stringify({ ...legacy, notes }))).toThrow("Invalid notes list");
    }
  });

  it("normalizes non-finite background angles passed directly to the validator", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const invalid = {
      ...snapshot,
      config: {
        ...snapshot.config,
        background: { type: "gradient" as const, from: "#102030", to: "#304050", angle: Number.NaN }
      }
    };
    expect(validateSnapshot(invalid).config.background).toEqual({
      type: "gradient",
      from: "#102030",
      to: "#304050",
      angle: DEFAULT_SETTINGS.background.type === "gradient" ? DEFAULT_SETTINGS.background.angle : 145
    });
  });

  it("keeps an empty-string URL as a bookmark in the diff projection", async () => {
    const projected = await prettySnapshot(snapshotFrom([{ title: "Empty URL", url: "" }], DEFAULT_SETTINGS));
    expect(projected).toContain('"url": ""');
    expect(projected).not.toContain('"children"');
  });

  it("keeps the beginning of a long URL without a protocol in the diff projection", async () => {
    const url = `first-eight-${"x".repeat(4_200)}`;
    const projected = JSON.parse(await prettySnapshot(snapshotFrom([{ title: "Long", url }], DEFAULT_SETTINGS))) as Snapshot;
    expect(projected.bookmarks[0]?.url).toContain(`unknown:${url.slice(0, 256)}`);
  });
});

describe("snapshot upload size", () => {
  it("uses the uploaded pretty JSON bytes at the exact 10 MiB boundary", () => {
    const timestamp = "2026-08-12T10:00:00.000+08:00";
    const makeSnapshot = (content: string): Snapshot => snapshotFrom([], DEFAULT_SETTINGS, [{
      id: "size-boundary",
      name: "Boundary",
      content,
      createtime: timestamp,
      updatetime: timestamp
    }], timestamp);
    const fixedBytes = snapshotBytes(makeSnapshot(""));
    const content = "x".repeat(MAX_SNAPSHOT_BYTES - fixedBytes);
    const exact = makeSnapshot(content);

    expect(new TextEncoder().encode(serializeSnapshot(exact)).byteLength).toBe(MAX_SNAPSHOT_BYTES);
    expect(() => validateSnapshot(exact)).not.toThrow();
    expect(() => validateSnapshot(makeSnapshot(`${content}x`))).toThrow("10 MiB");
  });
});

describe("eastEightTimestamp", () => {
  it("formats instants with an explicit +08:00 offset", () => {
    expect(eastEightTimestamp(new Date("2026-08-11T11:07:34.852Z"))).toBe("2026-08-11T19:07:34.852+08:00");
  });
});

describe("dynamic effect range schema", () => {
  it("does not accept object prototype property names as dynamic effects", () => {
    for (const value of ["constructor", "__proto__", "toString"]) {
      expect(isDynamicEffect(value)).toBe(false);
      expect(isDynamicEffectInput(value)).toBe(false);
      expect(normalizeDynamicEffect(value)).toBe("flow");
    }

    const invalid = JSON.parse(JSON.stringify(snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "flow", from: "#102030", to: "#304050", angle: 145, speed: 10 }
    })));
    invalid.config.background.effect = "constructor";
    expect(parseSnapshot(JSON.stringify(invalid)).config.background).toMatchObject({
      type: "dynamic",
      effect: "flow",
      from: "#102030",
      to: "#304050",
      angle: 145,
      speed: 10
    });
  });

  it("keeps numeric speed and parameter specs valid", () => {
    for (const definition of DYNAMIC_EFFECT_DEFINITIONS) {
      ensureInRange(definition.speed);
      if (definition.speed.integer) {
        expect(definition.speed.defaultValue).toBe(Math.round(definition.speed.defaultValue));
      }

      for (const parameter of definition.parameters) {
        if (!asRange(parameter)) continue;
        ensureInRange(parameter);
        if (parameter.integer) {
          expect(parameter.defaultValue).toBe(Math.round(parameter.defaultValue));
          expect(parameter.step).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("keeps exactly the five selected dynamic effects", () => {
    expect(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => definition.id)).toEqual([
      "flow",
      "cells",
      "liquidChrome",
      "dotGrid",
      "neuroNoise"
    ]);
  });

  it("uses practical product-tuned ranges for Cells, Liquid Chrome, and DotGrid", () => {
    const byId = Object.fromEntries(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => [definition.id, definition]));

    const cells = byId.cells;
    if (!cells) throw new Error("Missing cells effect definition");
    const dotGrid = byId.dotGrid;
    if (!dotGrid) throw new Error("Missing dotGrid effect definition");
    const liquidChrome = byId.liquidChrome;
    if (!liquidChrome) throw new Error("Missing liquidChrome effect definition");

    expect(findNumericRange(cells, "wallThickness")).toMatchObject({ min: 0.3, max: 2.5, step: 0.05, defaultValue: 1 });

    expect(findNumericRange(liquidChrome, "amplitude")).toMatchObject({ min: 0.02, max: 0.3, defaultValue: 0.2 });
    expect(findNumericRange(liquidChrome, "frequencyX")).toMatchObject({ min: 0.5, max: 12, defaultValue: 3 });
    expect(findNumericRange(liquidChrome, "frequencyY")).toMatchObject({ min: 0.5, max: 12, defaultValue: 2 });
    expect(findNumericRange(liquidChrome, "contrast")).toMatchObject({ min: 0, max: 3, defaultValue: 1 });
    expect(findNumericRange(liquidChrome, "lighting")).toMatchObject({ min: 0, max: 1, defaultValue: 0 });
    expect(dotGrid.speed).toMatchObject({ min: 5, max: 22, defaultValue: 10 });
    expect(findNumericRange(dotGrid, "dotSize").max).toBeLessThanOrEqual(120);
    expect(findNumericRange(dotGrid, "dotSize").min).toBeGreaterThanOrEqual(2);
    expect(findNumericRange(dotGrid, "gap").max).toBeLessThanOrEqual(160);
    expect(findNumericRange(dotGrid, "gap").min).toBeGreaterThanOrEqual(2);
    expect(findNumericRange(dotGrid, "proximity").max).toBeLessThanOrEqual(900);
    expect(findNumericRange(dotGrid, "proximity").min).toBeGreaterThanOrEqual(20);
    expect(findNumericRange(dotGrid, "speedTrigger").max).toBeLessThanOrEqual(500);
    expect(findNumericRange(dotGrid, "speedTrigger").min).toBeGreaterThanOrEqual(20);
    expect(findNumericRange(dotGrid, "shockRadius").max).toBeLessThanOrEqual(1200);
    expect(findNumericRange(dotGrid, "shockStrength").max).toBeLessThanOrEqual(10);
    expect(findNumericRange(dotGrid, "shockStrength").min).toBeGreaterThanOrEqual(0.2);
    expect(findNumericRange(dotGrid, "maxSpeed")).toMatchObject({ min: 300, max: 20000, step: 10 });
    expect(findNumericRange(dotGrid, "resistance")).toMatchObject({ min: 150, max: 4000, step: 10, defaultValue: 750 });
  });
});
