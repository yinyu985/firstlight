import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, snapshotFrom } from "./model";
import { DYNAMIC_EFFECT_DEFINITIONS, normalizeDynamicParameters, normalizeDynamicSpeed } from "./dynamicEffects";
import { parseSnapshot, parseSnapshotWithDiagnostics, serializeSnapshot, snapshotHash } from "./snapshot";
import { isEastEightTimestamp } from "./timestamp";

describe("strict snapshot normalization", () => {
  it.each(["2026-02-30T12:00:00.000+08:00", "2026-01-01T12:00:00+08:00", "2026-13-01T12:00:00.000+08:00", "2026-01-01T24:00:00.000+08:00"])(
    "rejects invalid timestamps: %s",
    (timestamp) => {
      expect(isEastEightTimestamp(timestamp)).toBe(false);
      const value = snapshotFrom([], DEFAULT_SETTINGS);
      expect(() => parseSnapshot(JSON.stringify({ ...value, updatedAt: timestamp }))).toThrow(/timestamp/);
      value.notes = [{ id: "a", name: "", content: "", createtime: timestamp, updatetime: timestamp }];
      expect(() => parseSnapshot(JSON.stringify(value))).toThrow();
    }
  );
  it("accepts a real leap day", () => {
    expect(isEastEightTimestamp("2028-02-29T12:00:00.001+08:00")).toBe(true);
  });
  it("serializes dynamic profile keys in the same order regardless of input order", async () => {
    const a = snapshotFrom([], {
      ...DEFAULT_SETTINGS,
      dynamicEffectProfiles: {
        flow: { from: "#112233", to: "#445566", angle: 0, speed: 1, parameters: {} },
        snow: { from: "#112233", to: "#445566", angle: 0, speed: 1, parameters: {} }
      }
    });
    const b = structuredClone(a);
    b.config.dynamicEffectProfiles = Object.fromEntries(Object.entries(a.config.dynamicEffectProfiles!).reverse());
    expect(await snapshotHash(a)).toBe(await snapshotHash(b));
    expect(serializeSnapshot(a)).toBe(serializeSnapshot(b));
  });
  it("returns field-level repair diagnostics while retaining valid data", () => {
    const value = snapshotFrom([], DEFAULT_SETTINGS);
    value.config.foreground.color = "damaged";
    value.config.foreground.fontSize = 18;
    const result = parseSnapshotWithDiagnostics(JSON.stringify(value));
    expect(result.settingsRepair).toBe("fields");
    expect(result.settingsRepairFields).toContain("foreground.color");
    expect(result.snapshot.config.foreground.fontSize).toBe(18);
  });
  it("restores defaults for out-of-range dynamic values", () => {
    for (const effect of DYNAMIC_EFFECT_DEFINITIONS) {
      const params = normalizeDynamicParameters(
        effect.id,
        Object.fromEntries(effect.parameters.filter((param) => param.kind === "range").map((param) => [param.key, 1e20]))
      );
      for (const param of effect.parameters) if (param.kind === "range") expect(params[param.key]).toBe(param.defaultValue);
      expect(normalizeDynamicSpeed(effect.id, 1e20)).toBe(effect.speed.defaultValue);
    }
  });
  it("ensures every range default is representable by its input step", () => {
    for (const effect of DYNAMIC_EFFECT_DEFINITIONS) {
      for (const range of [effect.speed, ...effect.parameters.filter((param) => param.kind === "range")]) {
        const index = (range.defaultValue - range.min) / range.step;
        expect(index, `${effect.id}: ${"key" in range ? range.key : "speed"}`).toBeCloseTo(Math.round(index), 6);
        const maximum = (range.max - range.min) / range.step;
        expect(maximum, `${effect.id}: maximum`).toBeCloseTo(Math.round(maximum), 6);
      }
    }
  });
});
