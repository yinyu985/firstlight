import { describe, expect, it } from "vitest";
import { getDynamicEffectDefinition } from "../shared/dynamicEffects";
import { dynamicTimeScale, hexToOklab, resolveCellWallThickness, resolveSmokeSettings } from "./DynamicBackground";
import { dotGridInertiaStep, dotGridProximityMix, dotGridReturnProgress, dotGridShockImpulse, resolveDotGridSettings } from "./backgrounds/DotGrid";
import { resolveGalaxySettings } from "./backgrounds/Galaxy";
import { lightPillarColor, resolveLightPillarSettings } from "./backgrounds/LightPillar";
import { resolveSnowSettings, snowColor } from "./backgrounds/Snow";
import { resolveSilkFlowSettings, silkFlowColor } from "./backgrounds/SilkFlow";
import { FLASH_AUTO_IDLE_MS, FLASH_DEFAULTS, flashAutoPointerStep, resolveFlashSettings, type FlashAutoPointerState } from "./backgrounds/Flash";

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

  it("uses the linked Flash state as defaults while keeping every control live and bounded", () => {
    expect(resolveFlashSettings()).toEqual(FLASH_DEFAULTS);
    expect(
      resolveFlashSettings({
        speed: 31,
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
      })
    ).toEqual({
      simResolution: 192,
      dyeResolution: 1024,
      densityDissipation: 6,
      velocityDissipation: 4,
      pressure: 0.7,
      curl: 20,
      splatRadius: 0.8,
      splatForce: 9000,
      colorUpdateSpeed: 31,
      autoMotion: true
    });
    expect(
      resolveFlashSettings({
        speed: 99,
        parameters: {
          simResolution: 1,
          dyeResolution: 9999,
          densityDissipation: 99,
          velocityDissipation: 0,
          pressure: -1,
          curl: 99,
          splatRadius: 0,
          splatForce: 99999,
          autoMotion: "invalid"
        }
      })
    ).toEqual({
      simResolution: 32,
      dyeResolution: 2048,
      densityDissipation: 10,
      velocityDissipation: 0.5,
      pressure: 0,
      curl: 30,
      splatRadius: 0.05,
      splatForce: 20000,
      colorUpdateSpeed: 50,
      autoMotion: false
    });
  });

  it("keeps Flash automatic pointer movement smooth, bounded, and wide-ranging", () => {
    expect(FLASH_AUTO_IDLE_MS).toBe(900);
    let state: FlashAutoPointerState = { x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, phase: 0 };
    let distance = 0;
    let directionChanges = 0;
    let minX = state.x;
    let maxX = state.x;
    let minY = state.y;
    let maxY = state.y;
    let previousVelocityX = state.velocityX;
    const first = flashAutoPointerStep(state, 1 / 60);
    expect(first.x).toBeGreaterThanOrEqual(0.5);
    expect(first.y).toBeCloseTo(0.5, 3);
    for (let frame = 0; frame < 1800; frame += 1) {
      const next = flashAutoPointerStep(state, 1 / 60);
      const stepDistance = Math.hypot(next.x - state.x, next.y - state.y);
      distance += stepDistance;
      if (Math.sign(previousVelocityX) !== 0 && Math.sign(next.velocityX) !== Math.sign(previousVelocityX)) directionChanges += 1;
      expect(stepDistance).toBeLessThan(0.01);
      expect(next.x).toBeGreaterThanOrEqual(0.08);
      expect(next.x).toBeLessThanOrEqual(0.92);
      expect(next.y).toBeGreaterThanOrEqual(0.08);
      expect(next.y).toBeLessThanOrEqual(0.92);
      expect(Object.values(next).every(Number.isFinite)).toBe(true);
      minX = Math.min(minX, next.x);
      maxX = Math.max(maxX, next.x);
      minY = Math.min(minY, next.y);
      maxY = Math.max(maxY, next.y);
      previousVelocityX = next.velocityX;
      state = next;
    }
    expect(distance).toBeGreaterThan(2.8);
    expect(directionChanges).toBeGreaterThan(1);
    expect(maxX - minX).toBeGreaterThan(0.7);
    expect(maxY - minY).toBeGreaterThan(0.4);
  });

  it("keeps Light Pillar's five user-facing controls bounded", () => {
    expect(resolveLightPillarSettings()).toEqual({ rotation: 0, pillarWidth: 8, pillarHeight: 0.4 });
    expect(resolveLightPillarSettings({ rotation: 500, pillarWidth: 50, pillarHeight: 0 })).toEqual({
      rotation: 180,
      pillarWidth: 12,
      pillarHeight: 0.1
    });
    expect(lightPillarColor("invalid", "#000000")).toEqual([0, 0, 0]);
    expect(lightPillarColor("#ffffff", "#000000")).toEqual([1, 1, 1]);
  });

  it("keeps every Galaxy control available and bounded", () => {
    expect(resolveGalaxySettings()).toMatchObject({
      focalX: 0.5,
      focalY: 0.5,
      rotationX: 1,
      rotationY: 0,
      starSpeed: 0.5,
      density: 1,
      hueShift: 140,
      disableAnimation: false,
      mouseInteraction: true,
      glowIntensity: 0.3,
      saturation: 0,
      mouseRepulsion: true,
      twinkleIntensity: 0.3,
      rotationSpeed: 0.1,
      repulsionStrength: 2,
      autoCenterRepulsion: 0,
      transparent: true
    });
    expect(resolveGalaxySettings({ focalX: -2, density: 9, hueShift: 900, repulsionStrength: -1 })).toMatchObject({
      focalX: 0,
      density: 3,
      hueShift: 360,
      repulsionStrength: 0
    });
    const centerRepulsion = getDynamicEffectDefinition("galaxy").parameters.find((parameter) => parameter.key === "autoCenterRepulsion");
    expect(centerRepulsion?.hint).toContain("大于 0 时中心推力优先，鼠标跟随和鼠标推开暂时不生效");
  });

  it("uses the linked Snow state as the complete bounded default", () => {
    expect(resolveSnowSettings()).toEqual({
      flakeSize: 0.019,
      minFlakeSize: 2.75,
      pixelResolution: 500,
      speed: 1.35,
      depthFade: 10,
      farPlane: 15,
      brightness: 3,
      gamma: 1,
      density: 0.5,
      variant: "snowflake",
      direction: 90
    });
    expect(
      resolveSnowSettings(99, {
        flakeSize: -1,
        minFlakeSize: 99,
        pixelResolution: 9999,
        depthFade: 0,
        farPlane: 999,
        brightness: 99,
        gamma: 0,
        density: 3,
        variant: "invalid" as "snowflake",
        direction: -20
      })
    ).toEqual({
      flakeSize: 0.001,
      minFlakeSize: 3,
      pixelResolution: 2000,
      speed: 5,
      depthFade: 1,
      farPlane: 50,
      brightness: 3,
      gamma: 0.1,
      density: 1,
      variant: "snowflake",
      direction: 0
    });
    expect(snowColor("#ff8040")).toEqual([1, 128 / 255, 64 / 255]);
    expect(snowColor("invalid", "#000000")).toEqual([0, 0, 0]);
  });

  it("uses the linked Silk state under its plain Chinese product name", () => {
    expect(resolveSilkFlowSettings()).toEqual({
      speed: 9,
      scale: 2,
      noiseIntensity: 3,
      rotation: 0
    });
    expect(resolveSilkFlowSettings(99, { scale: 0, noiseIntensity: 20, rotation: 20 })).toEqual({
      speed: 20,
      scale: 0.1,
      noiseIntensity: 5,
      rotation: 6.28
    });
    expect(silkFlowColor("#48b676")).toEqual([72 / 255, 182 / 255, 118 / 255]);
    expect(silkFlowColor("invalid", "#000000")).toEqual([0, 0, 0]);
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
