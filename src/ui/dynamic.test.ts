import { describe, expect, it } from "vitest";
import { dynamicTimeScale, hexToOklab } from "./DynamicBackground";

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
});
