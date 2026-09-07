import { expect, test } from "@playwright/test";
import { connectOnline, sampleSnapshot } from "./fixtures";

for (const effect of ["galaxy", "silk", "flash"] as const) {
  test(`${effect} stops drawing at rest and resumes on interaction or settings changes`, async ({ page }) => {
    await page.addInitScript(() => {
      const counters = { draws: 0 };
      Object.assign(window, { firstlightRenderCounters: counters });
      for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const original = prototype.drawArrays;
        prototype.drawArrays = function (...args) {
          counters.draws++;
          return original.apply(this, args);
        };
        const originalElements = prototype.drawElements;
        prototype.drawElements = function (...args) {
          counters.draws++;
          return originalElements.apply(this, args);
        };
      }
    });
    const snapshot = sampleSnapshot();
    snapshot.config.background = {
      type: "dynamic",
      effect,
      from: "#123456",
      to: "#abcdef",
      angle: 0,
      speed: effect === "silk" ? 0 : effect === "flash" ? 25 : 1,
      parameters:
        effect === "galaxy"
          ? { disableAnimation: true }
          : effect === "flash"
            ? { simResolution: 32, dyeResolution: 512, densityDissipation: 10, velocityDissipation: 5 }
            : {}
    };
    await connectOnline(page, snapshot);
    await expect(page.locator("canvas.dynamic-background")).toBeVisible();
    const draws = () => page.evaluate(() => (window as typeof window & { firstlightRenderCounters: { draws: number } }).firstlightRenderCounters.draws);
    if (effect === "flash") {
      await page.mouse.move(100, 180);
      await page.mouse.move(500, 190, { steps: 3 });
    }
    await expect.poll(draws).toBeGreaterThan(0);
    await expect
      .poll(
        async () => {
          const previous = await draws();
          await page.waitForTimeout(200);
          return (await draws()) - previous;
        },
        { timeout: 15_000 }
      )
      .toBe(0);
    const before = await draws();
    if (effect === "silk") {
      await page.getByRole("button", { name: "Open settings" }).click();
      await page.getByRole("slider", { name: "流动速度", exact: true }).fill("1");
    } else {
      await page.mouse.move(100, 200);
      await page.mouse.move(600, 240, { steps: 3 });
    }
    await expect.poll(draws).toBeGreaterThan(before);
  });
}

test("DotGrid stops drawing after motion settles and restarts on pointer input", async ({ page }) => {
  await page.addInitScript(() => {
    const counters = { draws: 0 };
    Object.assign(window, { firstlightRenderCounters: counters });
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      counters.draws += 1;
      return original.apply(this, args);
    };
  });
  const snapshot = sampleSnapshot();
  snapshot.config.background = { type: "dynamic", effect: "dotGrid", from: "#102030", to: "#abcdef", angle: 0, speed: 10 };
  await connectOnline(page, snapshot);
  await expect(page.locator(".dynamic-background canvas")).toBeVisible();
  const draws = () => page.evaluate(() => (window as typeof window & { firstlightRenderCounters: { draws: number } }).firstlightRenderCounters.draws);
  await expect.poll(draws).toBeGreaterThan(0);
  await expect
    .poll(
      async () => {
        const before = await draws();
        await page.waitForTimeout(100);
        return (await draws()) - before;
      },
      { timeout: 10_000 }
    )
    .toBe(0);
  const settled = await draws();
  await page.mouse.move(200, 200);
  await page.mouse.move(500, 300, { steps: 5 });
  await expect.poll(draws).toBeGreaterThan(settled);
});

test("Flash applies live parameters without recreating WebGL programs", async ({ page }) => {
  await page.addInitScript(() => {
    const counters = { programs: 0 };
    Object.assign(window, { firstlightRenderCounters: counters });
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const original = prototype.createProgram;
      prototype.createProgram = function () {
        counters.programs += 1;
        return original.call(this);
      };
    }
  });
  const snapshot = sampleSnapshot();
  snapshot.config.background = { type: "dynamic", effect: "flash", from: "#000000", to: "#000000", angle: 0, speed: 25, parameters: { autoMotion: true } };
  await connectOnline(page, snapshot);
  await expect(page.locator("canvas.dynamic-background")).toBeVisible();
  const programs = () => page.evaluate(() => (window as typeof window & { firstlightRenderCounters: { programs: number } }).firstlightRenderCounters.programs);
  await expect.poll(programs).toBeGreaterThan(0);
  const before = await programs();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("slider", { name: "颜色边缘精细度" })).toHaveValue("1440");
  const slider = page.getByRole("slider", { name: "旋涡强度" });
  await expect(slider).toHaveCount(1);
  await slider.fill("24");
  await expect(slider).toHaveValue("24");
  expect(await programs()).toBe(before);
});
