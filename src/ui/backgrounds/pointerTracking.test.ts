// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindWindowPointer, normalizedCanvasPointer } from "./pointerTracking";

function mockCanvasBounds(canvas: HTMLCanvasElement): void {
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 50,
    left: 100,
    top: 50,
    right: 500,
    bottom: 250,
    width: 400,
    height: 200,
    toJSON: () => ({})
  });
}

afterEach(() => vi.restoreAllMocks());

describe("background pointer tracking", () => {
  it("normalizes and clamps viewport coordinates with WebGL's upward y axis", () => {
    const canvas = document.createElement("canvas");
    mockCanvasBounds(canvas);

    expect(normalizedCanvasPointer(canvas, 300, 100)).toEqual({ x: 0.5, y: 0.75 });
    expect(normalizedCanvasPointer(canvas, 20, 400)).toEqual({ x: 0, y: 0 });
  });

  it("tracks pointer movement at window level so foreground UI cannot block it", () => {
    const canvas = document.createElement("canvas");
    mockCanvasBounds(canvas);
    const moves: Array<{ x: number; y: number }> = [];
    const activity: boolean[] = [];
    const unbind = bindWindowPointer(canvas, (pointer) => moves.push(pointer), (active) => activity.push(active));

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 420, clientY: 150 }));
    window.dispatchEvent(new MouseEvent("pointerout", { relatedTarget: null }));

    expect(moves).toEqual([{ x: 0.8, y: 0.5 }]);
    expect(activity).toEqual([true, false]);
    unbind();
  });
});
