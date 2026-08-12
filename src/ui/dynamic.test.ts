import { describe, expect, it } from "vitest";
import { dynamicTimeScale, hexToOklab } from "./DynamicBackground";
import { resolveBalatroSettings } from "./backgrounds/Balatro";
import { dotGridProximityMix, dotGridShockImpulse, resolveDotGridSettings } from "./backgrounds/DotGrid";
import { resolveLiquidChromeSettings } from "./backgrounds/LiquidChrome";
import { resolveTopographySettings } from "./backgrounds/Topography";

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

  it("routes every Topography control into its live renderer settings", () => {
    const settings = resolveTopographySettings({
      speed: 1.25,
      from: "#112233",
      to: "#ddeeff",
      parameters: {
        color3: "#4488cc",
        morphAmount: 5.5,
        morphSpeed: 0.17,
        bands: 7,
        thickness: 0.2,
        scale: 2.4,
        pixelSize: 24,
        glow: 1.1,
        colorMode: "alternating",
        contrast: 2.4,
        brightness: 1.45,
        fillBands: true,
        opacity: 0.35,
        grain: false,
        grainIntensity: 0.22,
        mouseInteraction: false,
        mouseRadius: 0.8,
        mouseStrength: 1.2
      }
    });

    expect(settings).toMatchObject({
      speed: 1.25,
      morphAmount: 5.5,
      morphSpeed: 0.17,
      bands: 7,
      thickness: 0.2,
      scale: 2.4,
      pixelSize: 24,
      glow: 1.1,
      colorMode: "alternating",
      contrast: 2.4,
      brightness: 1.45,
      fillBands: true,
      opacity: 0.35,
      grain: false,
      grainIntensity: 0.22,
      mouseInteraction: false,
      mouseRadius: 0.8,
      mouseStrength: 1.2
    });
    expect(settings.colors.mid).toEqual([0x44 / 255, 0x88 / 255, 0xcc / 255]);
  });

  it("caps Liquid Chrome amplitude at the product limit", () => {
    expect(resolveLiquidChromeSettings({ parameters: { amplitude: 2 } }).amplitude).toBe(0.3);
    expect(resolveLiquidChromeSettings({ parameters: {} }).amplitude).toBe(0.2);
  });

  it("uses the visible Balatro speed control as the shader spin speed", () => {
    expect(resolveBalatroSettings({ speed: 0.1, parameters: { spinSpeed: 20 } }).spinSpeed).toBe(0.1);
    expect(resolveBalatroSettings({ speed: 20, parameters: { spinSpeed: 0.1 } }).spinSpeed).toBe(20);
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
  });
});
