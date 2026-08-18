import { describe, expect, it } from "vitest";
import { formatFileSize, getNoteContentStats } from "./metrics";

describe("note content metrics", () => {
  it("counts logical lines, Unicode characters, and UTF-8 bytes", () => {
    expect(getNoteContentStats("First\n你好")).toEqual({
      lines: 2,
      characters: 8,
      bytes: 12,
      size: "12 B"
    });
  });

  it("shows an empty note as zero lines", () => {
    expect(getNoteContentStats("")).toEqual({ lines: 0, characters: 0, bytes: 0, size: "0 B" });
  });

  it("formats larger UTF-8 payloads for the status bar", () => {
    expect(formatFileSize(1_536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1_024 ** 2)).toBe("2.0 MB");
  });
});
