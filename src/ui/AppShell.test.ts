import { describe, expect, it } from "vitest";
import type { Background } from "../shared/model";
import { backgroundColorCss, backgroundImageCss, dynamicBackgroundHasColorControls } from "./AppShell";

describe("dynamic background fallback", () => {
  it("keeps Neuro's shader colors out of the page fallback", () => {
    const background: Background = {
      type: "dynamic",
      effect: "neuroNoise",
      speed: 1,
      parameters: {
        colorFront: "#eeeeee",
        colorMid: "#2288ff",
        colorBack: "#010409"
      }
    };

    expect(backgroundColorCss(background)).toBe("#070b12");
    expect(backgroundImageCss(background)).toBe("none");
  });

  it("uses the neutral page fallback when Neuro parameters are missing", () => {
    const background: Background = {
      type: "dynamic",
      effect: "neuroNoise",
      speed: 1,
      parameters: {}
    };

    expect(backgroundColorCss(background)).toBe("#070b12");
    expect(backgroundImageCss(background)).toBe("none");
  });

  it("uses a black base behind Light Pillar", () => {
    const background: Background = {
      type: "dynamic",
      effect: "lightPillar",
      from: "#5227ff",
      to: "#ff9ffc",
      angle: 145,
      speed: 0.3,
      parameters: { rotation: 0, pillarWidth: 8, pillarHeight: 0.4 }
    };

    expect(backgroundColorCss(background)).toBe("#000000");
    expect(backgroundImageCss(background)).toBe("none");
  });

  it("uses a black static fallback behind Snow", () => {
    const background: Background = {
      type: "dynamic",
      effect: "snow",
      from: "#ffffff",
      to: "#000000",
      angle: 0,
      speed: 1.35,
      parameters: { variant: "snowflake", pixelResolution: 500, direction: 90 }
    };

    expect(backgroundColorCss(background)).toBe("#000000");
    expect(backgroundImageCss(background)).toBe("none");
  });

  it("uses the selected Silk color as its static fallback", () => {
    const background: Background = {
      type: "dynamic",
      effect: "silk",
      from: "#48b676",
      to: "#48b676",
      angle: 0,
      speed: 9,
      parameters: { scale: 2, noiseIntensity: 3, rotation: 0 }
    };

    expect(backgroundColorCss(background)).toBe("#48b676");
    expect(backgroundImageCss(background)).toBe("none");
  });

  it("uses a black static fallback behind Flash", () => {
    const background: Background = {
      type: "dynamic",
      effect: "flash",
      from: "#000000",
      to: "#000000",
      angle: 0,
      speed: 25,
      parameters: { curl: 16, splatRadius: 0.65, velocityDissipation: 2.5 }
    };

    expect(backgroundColorCss(background)).toBe("#000000");
    expect(backgroundImageCss(background)).toBe("none");
    expect(dynamicBackgroundHasColorControls(background)).toBe(false);
    expect(dynamicBackgroundHasColorControls({ ...background, effect: "flow", speed: 10 })).toBe(true);
  });
});
