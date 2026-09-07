import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const label = `${version}-${revision}${dirty ? "-working" : ""}`;
const destination = resolve("release", label);
if (existsSync(destination)) throw new Error(`Release directory already exists: ${destination}`);
await mkdir(destination, { recursive: true });
const checksums = [];
for (const target of ["extension", "online"]) {
  const filename = `firstlight-${target}-${label}.zip`;
  const archive = resolve(destination, filename);
  execFileSync("zip", ["-qr", archive, "."], { cwd: resolve("dist", target) });
  const hash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  checksums.push(`${hash}  ${filename}`);
}
await writeFile(resolve(destination, "SHA256SUMS"), checksums.join("\n") + "\n");
console.log(`Release artifacts: ${destination}`);
