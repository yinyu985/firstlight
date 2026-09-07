// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { click, mountUi } from "./testing";

let mounted: Awaited<ReturnType<typeof mountUi>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  vi.restoreAllMocks();
});
function Broken(): never {
  throw new Error("simulated rendering failure");
}
it("contains a failing optional component and offers a dismissal", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const close = vi.fn();
  mounted = await mountUi(
    <>
      <p>Bookmarks still available</p>
      <ErrorBoundary name="Notes" onClose={close}>
        <Broken />
      </ErrorBoundary>
    </>
  );
  expect(mounted.host.textContent).toContain("Bookmarks still available");
  expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain("Notes could not be displayed");
  const button = [...mounted.host.querySelectorAll("button")].find((button) => button.textContent === "CLOSE")!;
  await click(button);
  expect(close).toHaveBeenCalledOnce();
});
it("silently falls back when a decorative background fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mounted = await mountUi(
    <ErrorBoundary name="Background" silent>
      <Broken />
    </ErrorBoundary>
  );
  expect(mounted.host.textContent).toBe("");
});
