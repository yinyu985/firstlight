import { describe, expect, it } from "vitest";
import { canOpenBookmark } from "./url";

describe("canOpenBookmark", () => {
  it("only opens protocols approved by the spec", () => {
    expect(canOpenBookmark("https://example.com")).toBe(true);
    expect(canOpenBookmark("http://example.com")).toBe(true);
    expect(canOpenBookmark("data:text/plain,hello")).toBe(true);
    expect(canOpenBookmark("javascript:alert(1)")).toBe(false);
    expect(canOpenBookmark("file:///tmp/a")).toBe(false);
    expect(canOpenBookmark("chrome://bookmarks")).toBe(false);
    expect(canOpenBookmark("custom:value")).toBe(false);
  });
});
