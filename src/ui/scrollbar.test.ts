import { describe, expect, it } from "vitest";
import { scrollbarMetrics } from "./scrollbar";

function fakeElement(scrollTop: number, clientHeight: number, scrollHeight: number): HTMLElement {
  return { scrollTop, clientHeight, scrollHeight } as HTMLElement;
}

describe("scrollbarMetrics", () => {
  it("hides when content fits", () => {
    expect(scrollbarMetrics(fakeElement(0, 400, 300))).toEqual({ visible: false, offset: 0, length: 20 });
  });

  it("caps thumb length and maps the scroll offset across the travel", () => {
    const metrics = scrollbarMetrics(fakeElement(50, 300, 600));
    expect(metrics.visible).toBe(true);
    expect(metrics.length).toBe(20);
    expect(metrics.offset).toBeCloseTo(46, 1);
  });

  it("clamps the thumb to the track when the viewport is very small", () => {
    expect(scrollbarMetrics(fakeElement(0, 14, 28))).toEqual({ visible: true, offset: 0, length: 10 });
  });

  it("shows no offset when scrolled to the top", () => {
    expect(scrollbarMetrics(fakeElement(0, 300, 600)).offset).toBe(0);
  });
});
