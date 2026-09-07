#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error("Usage: node scripts/extract-git-patch.mjs <firstlight.json> [output.patch]");
}

function fail(message) {
  console.error(`extract-git-patch: ${message}`);
  process.exitCode = 1;
}

function readSnapshot(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    // 1111.patch is an older export that contains the JSON object body without
    // its opening brace. Keep the extractor useful for that format as well.
    if (raw.trimStart().startsWith('"notes"')) {
      return JSON.parse(`{${raw}`);
    }
    throw new Error(`invalid JSON: ${error.message}`, { cause: error });
  }
}

function extractContent(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.notes)) {
    throw new Error("expected a JSON object with a notes array");
  }

  const notesWithContent = snapshot.notes.filter((note) => note && typeof note === "object" && typeof note.content === "string");

  if (notesWithContent.length !== 1) {
    throw new Error(`expected exactly one note with string content, found ${notesWithContent.length}`);
  }

  return notesWithContent[0].content;
}

function validatePatch(content) {
  if (!content.startsWith("diff --git ")) {
    throw new Error("content does not start with a Git patch header (diff --git)");
  }

  const fileHeaders = content.match(/^diff --git .+$/gm) ?? [];
  if (fileHeaders.length === 0) {
    throw new Error("content contains no Git file headers");
  }

  if (!/^--- .+$/m.test(content) || !/^\+\+\+ .+$/m.test(content)) {
    throw new Error("content is missing Git file markers (--- / +++)");
  }
}

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || inputArg === "-h" || inputArg === "--help") {
  usage();
  process.exitCode = inputArg ? 0 : 1;
} else {
  try {
    const inputPath = path.resolve(inputArg);
    const outputPath = path.resolve(outputArg ?? path.join(process.cwd(), `${path.basename(inputPath, path.extname(inputPath))}.patch`));

    if (inputPath === outputPath) {
      throw new Error("input and output paths must be different");
    }

    const content = extractContent(readSnapshot(inputPath));
    validatePatch(content);
    fs.writeFileSync(outputPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");

    const fileCount = content.match(/^diff --git .+$/gm)?.length ?? 0;
    console.log(`Wrote ${outputPath} (${fileCount} file${fileCount === 1 ? "" : "s"}).`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
