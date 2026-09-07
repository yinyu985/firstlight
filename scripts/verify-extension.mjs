import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("dist/extension");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const workerPath = resolve(root, manifest.background?.service_worker ?? "");

if (manifest.version !== packageJson.version) throw new Error("Manifest version must match package.json");
if (manifest.minimum_chrome_version !== "120") throw new Error("Manifest minimum Chrome version must match the build target");
for (const permission of ["alarms", "bookmarks", "storage", "unlimitedStorage"]) {
  if (!manifest.permissions?.includes(permission)) throw new Error(`Manifest permission is missing: ${permission}`);
}
for (const host of ["https://api.github.com/*", "https://gist.githubusercontent.com/*"]) {
  if (!manifest.host_permissions?.includes(host)) throw new Error(`Manifest host permission is missing: ${host}`);
}
if (!existsSync(workerPath)) throw new Error("Manifest service worker is missing");
const worker = readFileSync(workerPath, "utf8");
if (/^\s*import\s/m.test(worker) || /\bimport\s*\(/.test(worker)) {
  throw new Error("Extension service worker must be a self-contained bundle");
}
if (manifest.action && !/chrome\.action\.onClicked\.addListener/.test(worker)) {
  throw new Error("Manifest action must have a toolbar click handler");
}
if (!/chrome\.runtime\.onMessage\.addListener/.test(worker)) throw new Error("Extension worker message handler is missing");
if (!/chrome\.bookmarks\.onCreated\.addListener/.test(worker)) throw new Error("Extension bookmark listener is missing");
if (!/chrome\.alarms\.onAlarm\.addListener/.test(worker)) throw new Error("Extension upload alarm listener is missing");

function verifyPage(relativePath, label) {
  const pagePath = resolve(root, relativePath);
  if (!existsSync(pagePath)) throw new Error(`${label} is missing`);
  const page = readFileSync(pagePath, "utf8");
  if (/modulepreload|crossorigin/i.test(page)) {
    throw new Error("Extension HTML must not use module preload or crossorigin attributes");
  }
  for (const match of page.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)) {
    if (!existsSync(resolve(root, match[1]))) throw new Error(`Referenced extension asset is missing: ${match[1]}`);
  }
  return page;
}

verifyPage(manifest.chrome_url_overrides?.newtab ?? "", "New tab page");

console.log("Extension package verified");
