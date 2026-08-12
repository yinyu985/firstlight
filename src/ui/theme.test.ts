import { describe, expect, it } from "vitest";
import { deriveFolderTheme, sampleBackground } from "./theme";

describe("deriveFolderTheme", () => {
  it("derives a tonal surface from a solid background", () => {
    const dark = deriveFolderTheme({ type: "solid", color: "#000000" }, "#ffffff");
    const light = deriveFolderTheme({ type: "solid", color: "#ffffff" }, "#111111");
    expect(dark.surface).toMatch(/^#[0-9a-f]{6}$/);
    expect(light.surface).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark.surface).not.toContain("gradient");
    expect(light.surface).not.toContain("gradient");
    expect(dark.surface).not.toBe(light.surface);
  });

  it("samples a gradient locally without copying its angle into the surface", () => {
    const background = { type: "gradient" as const, from: "#102030", to: "#8090a0", angle: 90 };
    const left = deriveFolderTheme(background, "#e8f0ed", { x: 10, y: 50, width: 100, height: 100 });
    const right = deriveFolderTheme(background, "#e8f0ed", { x: 90, y: 50, width: 100, height: 100 });
    expect(left.surface).not.toBe(right.surface);
    expect(left.surface).toMatch(/^#[0-9a-f]{6}$/);
    expect(right.surface).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("maps CSS gradient direction to the sampled viewport position", () => {
    const background = { type: "gradient" as const, from: "#000000", to: "#ffffff", angle: 90 };
    expect(sampleBackground(background, { x: 0, y: 50, width: 100, height: 100 })).toBe("#000000");
    expect(sampleBackground(background, { x: 100, y: 50, width: 100, height: 100 })).toBe("#ffffff");
  });

  it("uses a translucent local surface for a dynamic background", () => {
    const background = { type: "dynamic" as const, from: "#071018", to: "#20bca0", angle: 145, speed: 10 };
    const first = deriveFolderTheme(background, "#ffffff", { x: 20, y: 25, width: 100, height: 100 });
    const second = deriveFolderTheme(background, "#ffffff", { x: 80, y: 75, width: 100, height: 100 });
    expect(first.surface).toMatch(/^rgba\(/);
    expect(second.surface).toBe(first.surface);
  });
});
