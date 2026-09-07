import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MAX_SNAPSHOT_BYTES, eastEightTimestamp, snapshotFrom, type SyncedSettings, type Snapshot } from "./model";
import {
  DYNAMIC_EFFECT_DEFINITIONS,
  isDynamicEffect,
  normalizeDynamicEffect,
  type DynamicEffectParameterDefinition,
  type DynamicSpeedSpec,
  type DynamicEffectDefinition
} from "./dynamicEffects";
import { parseSnapshot, prettySnapshot, serializeSnapshot, snapshotBytes, snapshotHash, stableStringify, validateSnapshot } from "./snapshot";

type RangeParameter = Extract<DynamicEffectParameterDefinition, { kind: "range" }>;

function asRange(parameter: DynamicEffectParameterDefinition): parameter is RangeParameter {
  return parameter.kind === "range";
}

function findNumericRange(definition: DynamicEffectDefinition, key: string): RangeParameter {
  const parameter = definition.parameters.find((candidate): candidate is RangeParameter => candidate.kind === "range" && candidate.key === key);
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
    expect(stableStringify({ z: 1, a: [{ b: 2, a: 1 }] })).toBe('{"a":[{"a":1,"b":2}],"z":1}');
  });
});

describe("snapshotHash", () => {
  it("ignores updatedAt and reacts to bookmark order", async () => {
    const first = snapshotFrom(
      [
        { title: "A", url: "https://example.com/a" },
        { title: "B", url: "https://example.com/b" }
      ],
      DEFAULT_SETTINGS
    );
    const later: Snapshot = { ...first, updatedAt: "2030-01-01T08:00:00.000+08:00" };
    const reordered: Snapshot = { ...later, bookmarks: [...later.bookmarks].reverse() };
    expect(await snapshotHash(first)).toBe(await snapshotHash(later));
    expect(await snapshotHash(first)).not.toBe(await snapshotHash(reordered));
  });

  it("allows duplicate URLs and folders with the same title", () => {
    expect(() =>
      validateSnapshot(
        snapshotFrom(
          [
            { title: "Same", url: "https://example.com" },
            { title: "Same", url: "https://example.com" },
            { title: "Folder", children: [] },
            { title: "Folder", children: [] }
          ],
          DEFAULT_SETTINGS
        )
      )
    ).not.toThrow();
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
    expect(Object.keys(snapshot.config.features)).toEqual([
      "searchPosition",
      "searchIcon",
      "searchText",
      "bookmarkDetails",
      "clockSeconds",
      "hoverStyle",
      "themeColor",
      "themeMode"
    ]);
    expect(Object.keys(snapshot.bookmarks[0])).toEqual(["title", "url"]);

    const remote = parseSnapshot(JSON.stringify(snapshot));
    expect(await prettySnapshot(remote)).toBe(await prettySnapshot(snapshot));
  });
});

describe("parseSnapshot", () => {
  it("removes unsupported generic colors and angle from Neuro backgrounds and profiles", () => {
    const input = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS))) as {
      config: {
        background: Record<string, unknown>;
        dynamicEffectProfiles: Record<string, unknown>;
      };
    };
    const parameters = {
      colorFront: "#f4f4f4",
      colorMid: "#248cff",
      colorBack: "#010409",
      brightness: 0.05,
      scale: 1,
      rotation: 0
    };
    input.config.background = {
      type: "dynamic",
      effect: "neuroNoise",
      from: "#ff0000",
      to: "#00ff00",
      angle: 211,
      speed: 1,
      parameters
    };
    input.config.dynamicEffectProfiles.neuroNoise = {
      from: "#ff0000",
      to: "#00ff00",
      angle: 211,
      speed: 1,
      parameters
    };

    const parsed = parseSnapshot(JSON.stringify(input));

    expect(Object.keys(parsed.config.background)).toEqual(["type", "effect", "speed", "parameters"]);
    expect(Object.keys(parsed.config.dynamicEffectProfiles?.neuroNoise ?? {})).toEqual(["speed", "parameters"]);
  });

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
    const input = JSON.parse(JSON.stringify(saved)) as {
      config: { dynamicEffectProfiles: Record<string, unknown> };
    };
    input.config.dynamicEffectProfiles = {
      ...input.config.dynamicEffectProfiles,
      unknownEffect: {
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
    const parsed = parseSnapshot(JSON.stringify(input));
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
      speed: 1,
      parameters: {
        colorFront: "#abc123",
        colorMid: "#def456",
        colorBack: "#fedcba",
        brightness: 0.35,
        scale: 1.8,
        rotation: 12
      }
    });
    expect(parsed.config.dynamicEffectProfiles?.neuroNoise).not.toHaveProperty("from");
    expect(parsed.config.dynamicEffectProfiles?.neuroNoise).not.toHaveProperty("to");
    expect(parsed.config.dynamicEffectProfiles?.neuroNoise).not.toHaveProperty("angle");
    expect(parsed.config.dynamicEffectProfiles?.neuroNoise?.parameters).not.toHaveProperty("contrast");
    expect(parsed.config.dynamicEffectProfiles?.snow).toMatchObject({
      from: "#445566",
      to: "#556677",
      angle: 44,
      speed: 1.35,
      parameters: { flakeSize: 0.019, variant: "snowflake", direction: 90 }
    });
    if (!flowProfile) throw new Error("Flow profile missing");
    expect(flowProfile.parameters).toEqual({});
    expect(parsed.config.dynamicEffectProfiles).not.toHaveProperty("unknownEffect");
    expect(parsed.config.dynamicEffectProfiles).not.toHaveProperty("cells");
  });

  it("drops unknown dynamic effect profile IDs", () => {
    const normalizedSnapshot = JSON.parse(
      JSON.stringify(
        snapshotFrom([], {
          ...DEFAULT_SETTINGS,
          background: { type: "dynamic", effect: "cells", from: "#102030", to: "#304050", angle: 145, speed: 17, parameters: { wallThickness: 1 } }
        })
      )
    ) as unknown as { config: { dynamicEffectProfiles: unknown } };
    normalizedSnapshot.config.dynamicEffectProfiles = {
      unknownEffect: {
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
    expect(currentBackground).toMatchObject({ effect: "cells", speed: 17 });
    expect(normalized.config.dynamicEffectProfiles).not.toHaveProperty("unknownEffect");
    expect(normalized.config.dynamicEffectProfiles).not.toHaveProperty("flow");
  });

  it("normalizes renderer-used parameters that were previously under-modeled", () => {
    const settingsByEffect: Record<string, SyncedSettings> = {
      flash: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "flash",
          from: "#000000",
          to: "#000000",
          angle: 145,
          speed: 25,
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
      },
      lightPillar: {
        ...DEFAULT_SETTINGS,
        background: {
          type: "dynamic",
          effect: "lightPillar",
          from: "#5227ff",
          to: "#ff9ffc",
          angle: 145,
          speed: 0.3,
          parameters: { rotation: -35, pillarWidth: 8.5, pillarHeight: 0.65 }
        }
      }
    };

    const flashSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.flash))) as {
      config: { background: { parameters: Record<string, unknown> } };
    };
    flashSnapshot.config.background.parameters.simResolution = 192;
    flashSnapshot.config.background.parameters.dyeResolution = 1024;
    flashSnapshot.config.background.parameters.densityDissipation = 6;
    flashSnapshot.config.background.parameters.velocityDissipation = 4;
    flashSnapshot.config.background.parameters.pressure = 0.7;
    flashSnapshot.config.background.parameters.curl = 20;
    flashSnapshot.config.background.parameters.splatRadius = 0.8;
    flashSnapshot.config.background.parameters.splatForce = 9000;
    flashSnapshot.config.background.parameters.autoMotion = true;
    const parsedFlash = parseSnapshot(JSON.stringify(flashSnapshot));

    const dotGridSnapshot = JSON.parse(JSON.stringify(snapshotFrom([], settingsByEffect.dotGrid))) as {
      config: { background: { parameters: Record<string, unknown> } };
    };
    const parsedDotGrid = parseSnapshot(JSON.stringify(dotGridSnapshot));
    const lightPillarSnapshot = snapshotFrom([], settingsByEffect.lightPillar);
    const parsedLightPillar = parseSnapshot(JSON.stringify(lightPillarSnapshot));

    expect(parsedFlash.config.background).toMatchObject({
      type: "dynamic",
      effect: "flash",
      speed: 25,
      parameters: {
        simResolution: 192,
        dyeResolution: 1024,
        densityDissipation: 6,
        velocityDissipation: 4,
        pressure: 0.7,
        curl: 20,
        splatRadius: 0.8,
        splatForce: 9000,
        autoMotion: true
      }
    });
    expect(parsedDotGrid.config.background).toMatchObject({
      type: "dynamic",
      parameters: { dotSize: 16, gap: 32, proximity: 150, speedTrigger: 100, maxSpeed: 5000 }
    });
    expect(parsedLightPillar.config.background).toMatchObject({
      type: "dynamic",
      effect: "lightPillar",
      from: "#5227ff",
      to: "#ff9ffc",
      speed: 0.3,
      parameters: { rotation: -35, pillarWidth: 8.5, pillarHeight: 0.65 }
    });
  });

  it("keeps current dynamic effect profiles while dropping unknown profile IDs", () => {
    const input = JSON.parse(
      JSON.stringify(
        snapshotFrom([], {
          ...DEFAULT_SETTINGS,
          background: {
            type: "dynamic",
            effect: "cells",
            from: "#102030",
            to: "#304050",
            angle: 145,
            speed: 10
          }
        })
      )
    ) as { config: { dynamicEffectProfiles: Record<string, unknown> } };
    input.config.dynamicEffectProfiles = {
      flow: {
        from: "#111111",
        to: "#222222",
        angle: 10,
        speed: 14,
        parameters: {}
      },
      unknownEffect: {
        from: "#999999",
        to: "#888888",
        angle: 180,
        speed: 12,
        parameters: {}
      }
    };

    const parsed = parseSnapshot(JSON.stringify(input));
    expect(parsed.config.dynamicEffectProfiles?.flow).toMatchObject({
      from: "#111111",
      to: "#222222",
      angle: 10,
      speed: 14
    });
    expect(parsed.config.dynamicEffectProfiles).not.toHaveProperty("unknownEffect");
  });

  it("accepts the current dynamic background structure", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "cells", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
    });
    expect(parseSnapshot(JSON.stringify(snapshot)).config.background).toEqual(snapshot.config.background);
  });

  it("defaults a missing dynamic effect to flow", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "flow", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
    });
    const input = JSON.parse(JSON.stringify(snapshot));
    delete input.config.background.effect;
    expect(parseSnapshot(JSON.stringify(input)).config.background).toEqual(snapshot.config.background);
  });

  it("treats every unknown dynamic effect ID as an invalid value", () => {
    const snapshot = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      background: { type: "dynamic", effect: "flow", from: "#102030", to: "#70d0c0", angle: 210, speed: 10 }
    });
    for (const effect of ["unknownEffect", "futureEffect"]) {
      const input = JSON.parse(JSON.stringify(snapshot));
      input.config.background.effect = effect;
      expect(parseSnapshot(JSON.stringify(input)).config.background).toMatchObject({ effect: "flow", speed: 10, parameters: {} });
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

  it("restores the default when hover style is missing", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const input = JSON.parse(JSON.stringify(snapshot));
    delete input.config.features.hoverStyle;
    expect(parseSnapshot(JSON.stringify(input)).config.features.hoverStyle).toBe("underline");
  });

  it("restores the default theme color when the field is missing", () => {
    const snapshot = snapshotFrom([], DEFAULT_SETTINGS);
    const input = JSON.parse(JSON.stringify(snapshot));
    delete input.config.features.themeColor;
    expect(parseSnapshot(JSON.stringify(input)).config.features.themeColor).toBe(DEFAULT_SETTINGS.features.themeColor);
  });

  it("drops unsupported feature fields instead of blocking the snapshot", () => {
    const snapshot = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    snapshot.config.features.futureToggle = true;
    expect(parseSnapshot(JSON.stringify(snapshot)).config.features).not.toHaveProperty("futureToggle");
  });

  it("replaces invalid searchText values with the current default", () => {
    const snapshot = parseSnapshot(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    const falseInput = JSON.parse(JSON.stringify(snapshot));
    falseInput.config.features.searchText = false;
    expect(parseSnapshot(JSON.stringify(falseInput)).config.features.searchText).toBe(DEFAULT_SETTINGS.features.searchText);

    const trueInput = JSON.parse(JSON.stringify(snapshot));
    trueInput.config.features.searchText = true;
    expect(parseSnapshot(JSON.stringify(trueInput)).config.features.searchText).toBe(DEFAULT_SETTINGS.features.searchText);
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

  it("rejects snapshots whose schema or settings version is not current", () => {
    const oldSchema = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    oldSchema.schemaVersion -= 1;
    expect(() => parseSnapshot(JSON.stringify(oldSchema))).toThrow("Unsupported snapshot version");

    const oldSettings = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    oldSettings.settingsVersion -= 1;
    expect(() => parseSnapshot(JSON.stringify(oldSettings))).toThrow("Unsupported settings version");
  });

  it("requires the East Eight timestamp offset", () => {
    const invalid = { ...snapshotFrom([], DEFAULT_SETTINGS), updatedAt: "2026-08-11T11:07:34.852Z" };
    expect(() => parseSnapshot(JSON.stringify(invalid))).toThrow("+08:00");
  });

  it("preserves opaque URL schemes without executing or filtering them", () => {
    const urls = ["javascript:alert(1)", "data:text/plain,hello", "file:///tmp/a", "custom:value"];
    const snapshot = snapshotFrom(
      urls.map((url) => ({ title: url, url })),
      DEFAULT_SETTINGS
    );
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

  it("rejects missing or malformed notes", () => {
    const input = JSON.parse(JSON.stringify(snapshotFrom([], DEFAULT_SETTINGS)));
    delete input.notes;
    expect(() => parseSnapshot(JSON.stringify(input))).toThrow("Invalid notes list");

    for (const notes of [{}, "invalid", 1, null, undefined]) {
      expect(() => validateSnapshot({ ...input, notes })).toThrow("Invalid notes list");
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
    const makeSnapshot = (content: string): Snapshot =>
      snapshotFrom(
        [],
        DEFAULT_SETTINGS,
        [
          {
            id: "size-boundary",
            name: "Boundary",
            content,
            createtime: timestamp,
            updatetime: timestamp
          }
        ],
        timestamp
      );
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
      expect(normalizeDynamicEffect(value)).toBe("flow");
    }

    const invalid = JSON.parse(
      JSON.stringify(
        snapshotFrom([], {
          ...DEFAULT_SETTINGS,
          background: { type: "dynamic", effect: "flow", from: "#102030", to: "#304050", angle: 145, speed: 10 }
        })
      )
    );
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

  it("keeps exactly the ten selected dynamic effects with Flow and Silk together", () => {
    expect(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => definition.id)).toEqual([
      "flow",
      "silk",
      "smoke",
      "cells",
      "flash",
      "dotGrid",
      "lightPillar",
      "galaxy",
      "snow",
      "neuroNoise"
    ]);
  });

  it("uses practical product-tuned ranges for Smoke, Cells, Flash, and DotGrid", () => {
    const byId = Object.fromEntries(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => [definition.id, definition]));

    const cells = byId.cells;
    if (!cells) throw new Error("Missing cells effect definition");
    const silk = byId.silk;
    if (!silk) throw new Error("Missing silk effect definition");
    const smoke = byId.smoke;
    if (!smoke) throw new Error("Missing smoke effect definition");
    const dotGrid = byId.dotGrid;
    if (!dotGrid) throw new Error("Missing dotGrid effect definition");
    const flash = byId.flash;
    if (!flash) throw new Error("Missing flash effect definition");
    const lightPillar = byId.lightPillar;
    if (!lightPillar) throw new Error("Missing lightPillar effect definition");
    const galaxy = byId.galaxy;
    if (!galaxy) throw new Error("Missing galaxy effect definition");
    const snow = byId.snow;
    if (!snow) throw new Error("Missing snow effect definition");

    expect(smoke.speed).toMatchObject({ min: 10, max: 20, defaultValue: 12 });
    expect(byId.flow?.label).toBe("FLOW I");
    expect(silk.label).toBe("FLOW II");
    expect(silk.speed).toMatchObject({ min: 0, max: 20, step: 0.1, defaultValue: 9, label: "流动速度" });
    expect(silk.defaultParameters).toEqual({ scale: 2, noiseIntensity: 3, rotation: 0 });
    expect(findNumericRange(silk, "scale")).toMatchObject({ min: 0.1, max: 5, step: 0.1, defaultValue: 2 });
    expect(findNumericRange(silk, "noiseIntensity")).toMatchObject({ min: 0, max: 5, step: 0.1, defaultValue: 3 });
    expect(findNumericRange(silk, "rotation")).toMatchObject({ min: 0, max: 6.28, step: 0.01, defaultValue: 0 });
    expect(findNumericRange(smoke, "smokeCount")).toMatchObject({ min: 1, max: 6, step: 1, defaultValue: 4, integer: true });
    expect(findNumericRange(smoke, "density")).toMatchObject({ min: 0.35, max: 1.5, defaultValue: 0.9 });
    expect(findNumericRange(smoke, "turbulence")).toMatchObject({ min: 0, max: 2, defaultValue: 1 });
    expect(findNumericRange(smoke, "spread")).toMatchObject({ min: 0.5, max: 2, defaultValue: 1 });

    expect(findNumericRange(cells, "wallThickness")).toMatchObject({ min: 0.3, max: 2.5, step: 0.05, defaultValue: 1 });

    expect(flash.label).toBe("FLASH");
    expect(flash.speed).toMatchObject({ min: 1, max: 50, step: 1, defaultValue: 25, integer: true, label: "换色速度" });
    expect(flash.parameters.map((parameter) => parameter.key)).toEqual([
      "simResolution",
      "dyeResolution",
      "densityDissipation",
      "velocityDissipation",
      "pressure",
      "curl",
      "splatRadius",
      "splatForce",
      "autoMotion"
    ]);
    expect(flash.defaultParameters).toEqual({
      simResolution: 128,
      dyeResolution: 1440,
      densityDissipation: 3.5,
      velocityDissipation: 2.5,
      pressure: 0.1,
      curl: 16,
      splatRadius: 0.65,
      splatForce: 6000,
      autoMotion: false
    });
    expect(findNumericRange(flash, "simResolution")).toMatchObject({ min: 32, max: 256, step: 32, defaultValue: 128, integer: true });
    expect(findNumericRange(flash, "dyeResolution")).toMatchObject({ min: 512, max: 2048, step: 32, defaultValue: 1440, integer: true });
    expect(findNumericRange(flash, "densityDissipation")).toMatchObject({ min: 0.5, max: 10, step: 0.5, defaultValue: 3.5 });
    expect(findNumericRange(flash, "velocityDissipation")).toMatchObject({ min: 0.5, max: 5, step: 0.5, defaultValue: 2.5 });
    expect(findNumericRange(flash, "pressure")).toMatchObject({ min: 0, max: 1, step: 0.1, defaultValue: 0.1 });
    expect(findNumericRange(flash, "curl")).toMatchObject({ min: 0, max: 30, step: 1, defaultValue: 16, integer: true });
    expect(findNumericRange(flash, "splatRadius")).toMatchObject({ min: 0.05, max: 1, step: 0.05, defaultValue: 0.65 });
    expect(findNumericRange(flash, "splatForce")).toMatchObject({ min: 1000, max: 20000, step: 500, defaultValue: 6000, integer: true });
    expect(flash.parameters.find((parameter) => parameter.key === "autoMotion")).toMatchObject({ kind: "toggle", label: "自动游走", defaultValue: false });
    expect(flash.parameters.every((parameter) => !parameter.hidden && typeof parameter.hint === "string" && parameter.hint.length > 0)).toBe(true);
    expect(dotGrid.speed).toMatchObject({ min: 5, max: 22, defaultValue: 10 });
    expect(dotGrid.speed.label).toBe("位移强度");
    expect(dotGrid.parameters.filter((parameter) => !parameter.hidden).map((parameter) => [parameter.key, parameter.label])).toEqual([
      ["dotSize", "圆点大小"],
      ["gap", "圆点间距"],
      ["proximity", "鼠标光圈大小"]
    ]);
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
    expect(lightPillar.speed).toMatchObject({ min: 0.05, max: 2, step: 0.05, defaultValue: 0.3, label: "流动速度" });
    expect(lightPillar.parameters.map((parameter) => [parameter.key, parameter.label])).toEqual([
      ["rotation", "光柱旋转角度"],
      ["pillarWidth", "光柱宽度"],
      ["pillarHeight", "光柱高度"]
    ]);
    expect(findNumericRange(lightPillar, "rotation")).toMatchObject({ min: -180, max: 180, step: 1, defaultValue: 0, integer: true });
    expect(findNumericRange(lightPillar, "pillarWidth")).toMatchObject({ min: 0.5, max: 12, step: 0.1, defaultValue: 8 });
    expect(findNumericRange(lightPillar, "pillarHeight")).toMatchObject({ min: 0.1, max: 2, step: 0.05, defaultValue: 0.4 });
    expect(galaxy.speed).toMatchObject({ min: 0.1, max: 3, step: 0.05, defaultValue: 1, label: "整体动画速度" });
    expect(galaxy.parameters.map((parameter) => parameter.key)).toEqual([
      "focalX",
      "focalY",
      "rotationX",
      "rotationY",
      "starSpeed",
      "density",
      "hueShift",
      "disableAnimation",
      "mouseInteraction",
      "glowIntensity",
      "saturation",
      "mouseRepulsion",
      "twinkleIntensity",
      "rotationSpeed",
      "repulsionStrength",
      "autoCenterRepulsion",
      "transparent"
    ]);
    expect(findNumericRange(galaxy, "starSpeed")).toMatchObject({ min: 0, max: 2, defaultValue: 0.5 });
    expect(findNumericRange(galaxy, "density")).toMatchObject({ min: 0.1, max: 3, defaultValue: 1 });
    expect(findNumericRange(galaxy, "hueShift")).toMatchObject({ min: 0, max: 360, step: 1, defaultValue: 140, integer: true });
    expect(findNumericRange(galaxy, "repulsionStrength")).toMatchObject({ min: 0, max: 5, defaultValue: 2 });
    expect(galaxy.parameters.every((parameter) => typeof parameter.hint === "string" && parameter.hint.length > 0)).toBe(true);
    expect(snow.label).toBe("SNOW");
    expect(snow.speed).toMatchObject({ min: 0.1, max: 5, step: 0.05, defaultValue: 1.35, label: "飘落速度" });
    expect(snow.defaultParameters).toEqual({
      flakeSize: 0.019,
      minFlakeSize: 2.75,
      pixelResolution: 500,
      depthFade: 10,
      farPlane: 15,
      brightness: 3,
      gamma: 1,
      density: 0.5,
      variant: "snowflake",
      direction: 90
    });
    expect(findNumericRange(snow, "flakeSize")).toMatchObject({ min: 0.001, max: 0.05, step: 0.001, defaultValue: 0.019 });
    expect(findNumericRange(snow, "minFlakeSize")).toMatchObject({ min: 0.5, max: 3, step: 0.25, defaultValue: 2.75 });
    expect(findNumericRange(snow, "pixelResolution")).toMatchObject({ min: 50, max: 2000, step: 25, defaultValue: 500, integer: true });
    expect(findNumericRange(snow, "direction")).toMatchObject({ min: 0, max: 360, step: 5, defaultValue: 90, integer: true });
  });

  it("uses plain Chinese labels and explanations for every visible dynamic control", () => {
    const containsChinese = (value: unknown) => typeof value === "string" && /[\u3400-\u9fff]/u.test(value);

    for (const definition of DYNAMIC_EFFECT_DEFINITIONS) {
      expect(containsChinese(definition.speed.label), `${definition.id} speed label`).toBe(true);
      expect(containsChinese(definition.speed.hint), `${definition.id} speed hint`).toBe(true);
      for (const parameter of definition.parameters) {
        expect(containsChinese(parameter.label), `${definition.id}.${parameter.key} label`).toBe(true);
        if (!parameter.hidden) {
          expect(containsChinese(parameter.hint), `${definition.id}.${parameter.key} hint`).toBe(true);
        }
      }
    }
  });
});
