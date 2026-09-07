import { expect, test } from "@playwright/test";
import { createServer } from "vite";

test("Online development connects HMR without weakening production HTML", async ({ page }) => {
  const server = await createServer({ mode: "online", server: { host: "127.0.0.1", port: 0 }, clearScreen: false });
  const errors: string[] = [];
  const frames: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => frames.push(String(payload))));
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Dev server did not bind a TCP port");
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.locator(".app")).toBeVisible();
    await expect.poll(() => frames.some((frame) => frame.includes('"type":"connected"'))).toBe(true);
    expect(errors).toEqual([]);
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count()).toBe(0);
    const production = await page.request.get("http://127.0.0.1:4173/");
    expect(production.headers()["content-security-policy"]).toContain("script-src 'self'");
    expect(await production.text()).toContain('http-equiv="Content-Security-Policy"');
  } finally {
    await page.goto("about:blank");
    await server.close();
  }
});
