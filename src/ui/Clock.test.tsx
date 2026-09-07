// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Clock } from "./Clock";
import { mountUi } from "./testing";

let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("updates at minute boundaries without rendering its parent on every tick", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-12T04:00:30.000Z"));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const parentRender = vi.fn();
  function Parent() {
    parentRender();
    return <Clock showSeconds={false} />;
  }
  mounted = await mountUi(<Parent />);
  const initial = document.querySelector("time")!.textContent;
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(29_999);
  });
  expect(document.querySelector("time")!.textContent).toBe(initial);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(document.querySelector("time")!.textContent).not.toBe(initial);
  expect(parentRender).toHaveBeenCalledTimes(1);
});

it("pauses while hidden and immediately catches up when shown", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-12T04:00:00.000Z"));
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  mounted = await mountUi(<Clock showSeconds />);
  const initial = document.querySelector("time")!.textContent;
  hidden.mockReturnValue(true);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(vi.getTimerCount()).toBe(0);
  expect(document.querySelector("time")!.textContent).toBe(initial);
  hidden.mockReturnValue(false);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(document.querySelector("time")!.textContent).not.toBe(initial);
  expect(vi.getTimerCount()).toBe(1);
});
