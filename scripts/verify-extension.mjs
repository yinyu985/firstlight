import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("dist/extension");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const workerPath = resolve(root, manifest.background?.service_worker ?? "");

if (!existsSync(workerPath)) throw new Error("Manifest service worker is missing");
const worker = readFileSync(workerPath, "utf8");
if (/^\s*import\s/m.test(worker) || /\bimport\s*\(/.test(worker)) {
  throw new Error("Extension service worker must be a self-contained bundle");
}
if (manifest.action && !/chrome\.action\.onClicked\.addListener/.test(worker)) {
  throw new Error("Manifest action must have a toolbar click handler");
}

const pagePath = resolve(root, manifest.chrome_url_overrides?.newtab ?? "");
if (!existsSync(pagePath)) throw new Error("New tab page is missing");
const page = readFileSync(pagePath, "utf8");
if (/modulepreload|crossorigin/i.test(page)) {
  throw new Error("Extension HTML must not use module preload or crossorigin attributes");
}
for (const match of page.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)) {
  if (!existsSync(resolve(root, match[1]))) throw new Error(`Referenced extension asset is missing: ${match[1]}`);
}

console.log("Extension package verified");
