import { describe, expect, it } from "vitest";
import { dynamicTimeScale, hexToOklab, resolveCellWallThickness, resolveSmokeSettings } from "./DynamicBackground";
import {
  dotGridInertiaStep,
  dotGridProximityMix,
  dotGridReturnProgress,
  dotGridShockImpulse,
  resolveDotGridSettings
} from "./backgrounds/DotGrid";
import { resolveLiquidChromeSettings } from "./backgrounds/LiquidChrome";

describe("Dynamic background", () => {
  it("maps the complete speed range monotonically and gives the fast end real range", () => {
    const scales = Array.from({ length: 11 }, (_, index) => dynamicTimeScale(index + 10));
    expect(scales[0]).toBeCloseTo(0.54);
    expect(scales[10]).toBeCloseTo(2.21);
    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]).toBeGreaterThan(scales[index - 1]);
    }
    expect(scales[10] / scales[0]).toBeGreaterThan(4);
  });

  it("converts endpoint colors to finite OKLab uniforms without collapsing contrast", () => {
    const black = hexToOklab("#000000");
    const white = hexToOklab("#ffffff");
    expect(black.every(Number.isFinite)).toBe(true);
    expect(white.every(Number.isFinite)).toBe(true);
    expect(black[0]).toBeCloseTo(0);
    expect(white[0]).toBeCloseTo(1);
    expect(white[0] - black[0]).toBeGreaterThan(0.99);
  });

  it("keeps Cells wall thickness live, bounded, and backward compatible", () => {
    expect(resolveCellWallThickness(undefined)).toBe(1);
    expect(resolveCellWallThickness({ wallThickness: 1.65 })).toBe(1.65);
    expect(resolveCellWallThickness({ wallThickness: 0.1 })).toBe(0.3);
    expect(resolveCellWallThickness({ wallThickness: 9 })).toBe(2.5);
  });

  it("keeps Smoke density, turbulence, and spread within its visual limits", () => {
    expect(resolveSmokeSettings(undefined)).toEqual({ density: 0.9, smokeCount: 4, turbulence: 1, spread: 1 });
    expect(resolveSmokeSettings({ density: 0.1, smokeCount: 9.4, turbulence: 9, spread: 0.2 })).toEqual({
      density: 0.35,
      smokeCount: 6,
      turbulence: 2,
      spread: 0.5
    });
  });

  it("caps Liquid Chrome amplitude at the product limit", () => {
    expect(resolveLiquidChromeSettings({ parameters: { amplitude: 2 } }).amplitude).toBe(0.3);
    expect(resolveLiquidChromeSettings({ parameters: {} }).amplitude).toBe(0.2);
  });

  it("restores the original Chrome renderer settings", () => {
    const settings = resolveLiquidChromeSettings({
      from: "#ff0000",
      to: "#0000ff",
      parameters: {
        frequencyX: 4.5,
        frequencyY: 6,
        color3: "#00ff00",
        contrast: 1.8,
        lighting: 0.35
      }
    });
    expect(settings).toMatchObject({
      frequencyX: 4.5,
      frequencyY: 6,
      amplitude: 0.2,
      contrast: 1.8,
      lighting: 0.35,
      baseColor: [0.425, 0.15, 0.425]
    });
    expect(resolveLiquidChromeSettings({ parameters: { mouseInteraction: false, mouseStrength: 2.4 } })).toMatchObject({
      mouseInteraction: false,
      mouseStrength: 2.4
    });
  });

  it("keeps Dot Grid interaction controls independent and wired into impulse physics", () => {
    const settings = resolveDotGridSettings(10, {
      proximity: 420,
      shockRadius: 300,
      shockStrength: 8,
      resistance: 1800,
      returnDuration: 3.25
    });
    expect(settings).toMatchObject({
      proximity: 420,
      shockRadius: 300,
      shockStrength: 8,
      resistance: 1800,
      returnDuration: 3.25
    });
    expect(dotGridProximityMix(210, settings.proximity)).toBe(0.5);

    const impulse = dotGridShockImpulse(100, 0, 100, settings);
    expect(impulse?.x).toBeCloseTo(100 * 8 * (2 / 3));
    expect(impulse).toMatchObject({ y: 0, resistance: 1800, returnDuration: 3.25 });
    expect(dotGridShockImpulse(300, 0, 300, settings)).toBeNull();

    const lowResistance = dotGridInertiaStep(1000, 150, 0.05);
    const highResistance = dotGridInertiaStep(1000, 4000, 0.05);
    expect(lowResistance.distance).toBeGreaterThan(highResistance.distance);
    expect(lowResistance.speed).toBeGreaterThan(highResistance.speed);
    expect(dotGridReturnProgress(0.5, 1)).toBe(0.5);
    expect(dotGridReturnProgress(0.5, 2)).toBe(0.25);
  });
});
