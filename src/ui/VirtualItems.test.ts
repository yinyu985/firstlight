import { describe, expect, it } from "vitest";
import { virtualRange } from "./VirtualItems";

describe("large list windows", () => {
  it.each([0, 10_000, 500_000, 999_999])("keeps a bounded window at scroll offset %s", (offset) => {
    const range = virtualRange(100_000, 4, 40, offset, 800);
    expect(range.start).toBeGreaterThanOrEqual(0);
    expect(range.end).toBeLessThanOrEqual(100_000);
    expect(range.end - range.start).toBeLessThanOrEqual(136);
  });
  it("keeps the last row reachable after a list shrinks", () => {
    expect(virtualRange(600, 4, 40, 1_000_000, 800).end).toBe(600);
  });
});
