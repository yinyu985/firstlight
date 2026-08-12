import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, eastEightTimestamp, snapshotFrom, type SyncedSettings, type Snapshot } from "./model";
import { DYNAMIC_EFFECT_DEFINITIONS, type DynamicEffectParameterDefinition, type DynamicSpeedSpec, type DynamicEffectDefinition } from "./dynamicEffects";
import { parseSnapshot, prettySnapshot, snapshotHash, stableStringify, validateSnapshot } from "./snapshot";

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
    expect(Object.keys(snapshot.config)).toEqual(["openTarget", "background", "dynamicEffectProfiles", "foreground", "layout", "clockPosition", "features"]);
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
        },
        snow: {
          from: "#445566",
          to: "#556677",
          angle: 44,
          speed: 18,
          parameters: {}
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
    expect(parsed.config.dynamicEffectProfiles?.snow).toEqual({
      from: "#445566",
      to: "#556677",
      angle: 44,
      speed: 18,
      parameters: {}
    });
    if (!flowProfile) throw new Error("Flow profile missing");
    expect(flowProfile.parameters).toEqual({});
    expect(parsed.config.dynamicEffectProfiles?.cells).toMatchObject({
      from: "#778899",
      to: "#99aabb",
      angle: 180,
      speed: 17,
      parameters: {}
    });
  });

  it("migrates legacy ferrofluid background profile to flow", () => {
    const normalizedSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "moltenMetal", from: "#102030", to: "#304050", angle: 145, speed: 999, parameters: { mouseInteraction: "bad" as never, scale: "x" as never, color3: "#ffffff", detail: 4 } }
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
    const moltenBackground = normalized.config.background;
    if (moltenBackground.type !== "dynamic") throw new Error("Expected dynamic background");
    const flowProfile = normalized.config.dynamicEffectProfiles?.flow;
    if (!flowProfile) throw new Error("Expected migrated flow profile");

    expect(moltenBackground.speed).toBe(2.5);
    expect(flowProfile.speed).toBe(14);
    expect(flowProfile.parameters).toEqual({});
    expect(normalized.config.dynamicEffectProfiles).not.toHaveProperty("ferrofluid");
  });

  it("normalizes renderer-used parameters that were previously under-modeled", () => {
    const settingsByEffect: Record<string, SyncedSettings> = {
      topography: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "topography",
          from: "#102030",
          to: "#304050",
          angle: 145,
          speed: 1,
          parameters: {}
        }
      },
      webThreads: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "webThreads",
          from: "#102030",
          to: "#304050",
          angle: 145,
          speed: 1,
          parameters: {}
        }
      },
      moltenMetal: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "moltenMetal",
          from: "#102030",
          to: "#304050",
          angle: 145,
          speed: 1,
          parameters: {}
        }
      },
      balatro: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "balatro",
          from: "#102030",
          to: "#304050",
          angle: 145,
          speed: 1,
          parameters: {}
        }
      },
      iridescence: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "iridescence",
          from: "#102030",
          to: "#304050",
          angle: 145,
          speed: 1,
          parameters: {}
        }
      },
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

    const topographySnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.topography))) as { config: { background: { parameters: Record<string, unknown> } } };
    topographySnapshot.config.background.parameters.opacity = 1.8;
    const parsedTopography = parseSnapshot(JSON.stringify(topographySnapshot));

    const webThreadsSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.webThreads))) as { config: { background: { parameters: Record<string, unknown> } } };
    webThreadsSnapshot.config.background.parameters.opacity = 1.25;
    webThreadsSnapshot.config.background.parameters.mouseStrength = 0.45;
    const parsedWebThreads = parseSnapshot(JSON.stringify(webThreadsSnapshot));

    const moltenSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.moltenMetal))) as { config: { background: { parameters: Record<string, unknown> } } };
    moltenSnapshot.config.background.parameters.opacity = 0.4;
    moltenSnapshot.config.background.parameters.contrast = "bad" as never;
    const parsedMolten = parseSnapshot(JSON.stringify(moltenSnapshot));

    const iridescenceSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.iridescence))) as { config: { background: { parameters: Record<string, unknown> } } };
    iridescenceSnapshot.config.background.parameters.color3 = "#c3d4e5";
    iridescenceSnapshot.config.background.parameters.scale = 1.2;
    iridescenceSnapshot.config.background.parameters.brightness = 1.25;
    iridescenceSnapshot.config.background.parameters.contrast = 2.2;
    iridescenceSnapshot.config.background.parameters.lighting = 0.4;
    const parsedIridescence = parseSnapshot(JSON.stringify(iridescenceSnapshot));

    const liquidChromeSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.liquidChrome))) as { config: { background: { parameters: Record<string, unknown> } } };
    liquidChromeSnapshot.config.background.parameters.color3 = "#fefefe";
    liquidChromeSnapshot.config.background.parameters.interactive = false;
    liquidChromeSnapshot.config.background.parameters.brightness = 1.4;
    liquidChromeSnapshot.config.background.parameters.contrast = 2.0;
    liquidChromeSnapshot.config.background.parameters.lighting = 0.2;
    const parsedLiquid = parseSnapshot(JSON.stringify(liquidChromeSnapshot));

    const balatroSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.balatro))) as { config: { background: { parameters: Record<string, unknown> } } };
    balatroSnapshot.config.background.parameters.spinSpeed = 0.07;
    const parsedBalatro = parseSnapshot(JSON.stringify(balatroSnapshot));

    const dotGridSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.dotGrid))) as { config: { background: { parameters: Record<string, unknown> } } };
    const parsedDotGrid = parseSnapshot(JSON.stringify(dotGridSnapshot));

    expect(parsedTopography.config.background).toMatchObject({ type: "dynamic", parameters: { opacity: 1 } });
    expect(parsedWebThreads.config.background).toMatchObject({ type: "dynamic", parameters: { opacity: 1, mouseStrength: 0.45 } });
    expect(parsedMolten.config.background).toMatchObject({ type: "dynamic", parameters: { opacity: 0.4 } });
    expect(parsedIridescence.config.background).toMatchObject({
      type: "dynamic",
      parameters: { amplitude: 1.2, color3: "#c3d4e5", brightness: 1.25, contrast: 2.2, lighting: 0.4 }
    });
    expect(parsedLiquid.config.background).toMatchObject({
      type: "dynamic",
      parameters: { mouseInteraction: false, color3: "#fefefe", brightness: 1.4, contrast: 2, lighting: 0.2 }
    });
    expect(parsedBalatro.config.background).toMatchObject({ type: "dynamic", speed: 1 });
    if (parsedBalatro.config.background.type !== "dynamic") throw new Error("Expected dynamic Balatro background");
    expect(parsedBalatro.config.background.parameters).not.toHaveProperty("spinSpeed");
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
        effect: "aurora",
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
      background: { type: "dynamic", effect: "aurora", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
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

    const legacyParticles = JSON.parse(JSON.stringify(snapshot));
    legacyParticles.config.background.effect = "particles";
    expect(parseSnapshot(JSON.stringify(legacyParticles)).config.background).toMatchObject({ effect: "snow" });

    for (const effect of ["dither", "rings"]) {
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

  it("defaults hover color for snapshots saved before the setting existed", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const legacy = JSON.parse(JSON.stringify(snapshot));
    delete legacy.config.features.hoverColor;
    expect(parseSnapshot(JSON.stringify(legacy)).config.features.hoverColor).toBe("#59d5b8");
  });

  it("accepts legacy boolean searchText values", () => {
    const snapshot = parseSnapshot(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    const hiddenLegacy = JSON.parse(JSON.stringify(snapshot));
    hiddenLegacy.config.features.searchText = false;
    expect(parseSnapshot(JSON.stringify(hiddenLegacy)).config.features.searchText).toBe("hidden");

    const leftLegacy = JSON.parse(JSON.stringify(snapshot));
    leftLegacy.config.features.searchText = true;
    expect(parseSnapshot(JSON.stringify(leftLegacy)).config.features.searchText).toBe("left");
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

describe("dynamic effect range schema", () => {
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

  it("uses practical product-tuned ranges for Topography, Liquid Chrome, Balatro, and DotGrid", () => {
    const byId = Object.fromEntries(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => [definition.id, definition]));

    const topography = byId.topography;
    if (!topography) throw new Error("Missing topography effect definition");
    const dotGrid = byId.dotGrid;
    if (!dotGrid) throw new Error("Missing dotGrid effect definition");
    const liquidChrome = byId.liquidChrome;
    if (!liquidChrome) throw new Error("Missing liquidChrome effect definition");
    const balatro = byId.balatro;
    if (!balatro) throw new Error("Missing balatro effect definition");

    expect(topography.speed).toMatchObject({ min: 0, max: 2, defaultValue: 0.35 });
    expect(findNumericRange(topography, "bands")).toMatchObject({ min: 1, max: 8, step: 1, integer: true, defaultValue: 2 });
    expect(findNumericRange(topography, "contrast").min).toBeGreaterThanOrEqual(1);
    expect(findNumericRange(topography, "contrast").max).toBeLessThanOrEqual(3);
    expect(findNumericRange(topography, "brightness").min).toBeGreaterThanOrEqual(0.4);
    expect(findNumericRange(topography, "brightness").max).toBeLessThanOrEqual(1.6);

    expect(findNumericRange(liquidChrome, "amplitude")).toMatchObject({ min: 0.02, max: 0.3, defaultValue: 0.2 });
    expect(balatro.speed).toMatchObject({ min: 0.1, max: 20, defaultValue: 7 });
    expect(balatro.parameters.some((parameter) => parameter.key === "spinSpeed")).toBe(false);

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
