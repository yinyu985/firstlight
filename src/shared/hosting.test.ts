import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_CSP, VIEWER_CSP, RENDERER_CSP, cloudflareHeaders, pageCsp } from "../../hosting";

describe("deployed security headers", () => {
  it("keeps the app and the opaque bookmark renderer on separate policies", () => {
    expect(pageCsp("/")).toBe(APP_CSP);
    expect(pageCsp("/data-viewer")).toBe(VIEWER_CSP);
    expect(pageCsp("/data-renderer.html")).toBe(RENDERER_CSP);
    expect(pageCsp("/assets/app.js")).toBeUndefined();
    expect(APP_CSP).toContain("frame-ancestors 'none'");
    expect(RENDERER_CSP).toContain("frame-ancestors 'self'");
    expect(cloudflareHeaders()).not.toContain("undefined");
  });
  it("does not drift between Vercel, Cloudflare and the local preview", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
    for (const rule of vercel.headers) {
      const policy = rule.headers.find((header) => header.key === "Content-Security-Policy");
      if (policy) {
        expect(policy.value).toBe(pageCsp(rule.source));
        expect(cloudflareHeaders()).toContain(`${rule.source}\n  Content-Security-Policy: ${policy.value}`);
      }
    }
  });
});
