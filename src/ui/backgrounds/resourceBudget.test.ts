import { describe, expect, it } from "vitest";
import { createFrameGate } from "./frameBudget";
import { boundedDotGrid, boundedTextureSize, MAX_DOTS, MAX_FLUID_TEXTURE_PIXELS } from "./resourceBudget";

describe("background resource budgets", () => {
  it.each([60, 120, 144, 240])("limits %i Hz displays to approximately 60 draws per second", (refreshRate) => {
    const draw = createFrameGate();
    let count = 0;
    for (let index = 0; index < refreshRate * 5; index++) if (draw((index * 1000) / refreshRate)) count++;
    expect(count).toBeGreaterThanOrEqual(295);
    expect(count).toBeLessThanOrEqual(301);
  });
  it.each([
    [3840, 2160],
    [7680, 1080],
    [100000, 1000]
  ])("bounds DOT object count at %i by %i", (width, height) => {
    const grid = boundedDotGrid(width, height, 2, 2);
    expect(grid.cols * grid.rows).toBeLessThanOrEqual(MAX_DOTS);
    expect(grid.cell).toBeGreaterThanOrEqual(4);
  });
  it("preserves ordinary DOT spacing", () => {
    expect(boundedDotGrid(1200, 800, 6, 32)).toMatchObject({ cell: 38, gap: 32 });
  });
  it.each([
    [8192, 2048, 4096],
    [32000, 2048, 16384],
    [2048, 8192, 1024]
  ])("bounds fluid textures by memory and hardware dimensions", (width, height, limit) => {
    const size = boundedTextureSize(width, height, limit);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_FLUID_TEXTURE_PIXELS);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(limit);
    expect(size.width / size.height).toBeCloseTo(width / height, 1);
  });
});
