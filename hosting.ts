export const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://gist.githubusercontent.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
export const VIEWER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
export const RENDERER_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' https: blob: data:; style-src 'unsafe-inline' https: blob: data:; img-src https: blob: data:; font-src https: data:; media-src https: blob: data:; connect-src https: data:; frame-src https: blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
export const COMMON_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()"
};

export function pageCsp(path: string): string | undefined {
  if (/\/data-renderer(?:\.html)?$/.test(path)) return RENDERER_CSP;
  if (/\/data-viewer(?:\.html)?$/.test(path)) return VIEWER_CSP;
  if (path.endsWith("/") || /\/(?:index|help|privacy)(?:\.html)?$/.test(path)) return APP_CSP;
  return undefined;
}

export function cloudflareHeaders(): string {
  const lines = ["/*", ...Object.entries(COMMON_HEADERS).map(([key, value]) => `  ${key}: ${value}`)];
  for (const path of [
    "/",
    "/index.html",
    "/index",
    "/help.html",
    "/help",
    "/privacy.html",
    "/privacy",
    "/data-viewer.html",
    "/data-viewer",
    "/data-renderer.html",
    "/data-renderer"
  ]) {
    lines.push(path, `  Content-Security-Policy: ${pageCsp(path)}`);
  }
  return lines.join("\n") + "\n";
}
