import { describe, expect, it } from "vitest";
import type { Background } from "../shared/model";
import { backgroundColorCss, backgroundImageCss } from "./AppShell";

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
});
