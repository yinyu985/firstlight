import { describe, expect, it, vi } from "vitest";
import { countBookmarkUrls, createBookmarkIndex, faviconUrl, searchBookmarkIndex, searchBookmarks } from "./bookmarks";

describe("bookmark search", () => {
  const tree = [
    { title: "Work", children: [{ title: "Docs", children: [{ title: "Guide", url: "https://example.test/docs" }] }] },
    { title: "Guide", url: "https://other.test" }
  ];
  it("searches titles, URLs and every parent folder while retaining disambiguating paths", () => {
    expect(searchBookmarks(tree, " WORK ")).toEqual([expect.objectContaining({ path: "Work / Docs" })]);
    expect(searchBookmarks(tree, "EXAMPLE.TEST")).toHaveLength(1);
    expect(searchBookmarks(tree, "guide")).toHaveLength(2);
    expect(searchBookmarks(tree, "   ")).toEqual([]);
    expect(searchBookmarks(tree, "absent")).toEqual([]);
    expect(countBookmarkUrls(tree)).toBe(2);
    expect(countBookmarkUrls(tree)).toBe(2);
  });
  it("indexes 100,000 bookmarks and reports truncated results without losing the last match", () => {
    const entries = Array.from({ length: 100_000 }, (_, i) => ({ title: `Bookmark ${i}`, url: `https://example.test/${i}` }));
    const index = createBookmarkIndex(entries);
    expect(index).toHaveLength(100_000);
    const result = searchBookmarkIndex(index, "Bookmark");
    expect(result.results).toHaveLength(80);
    expect(result.truncated).toBe(true);
    expect(searchBookmarkIndex(index, "Bookmark 99999")).toMatchObject({ results: [expect.objectContaining({ item: entries[99_999] })], truncated: false });
  });
  it("only supplies favicons for web URLs", () => {
    vi.stubGlobal("chrome", { runtime: { id: "test" } });
    expect(faviconUrl("https://example.test")).toContain("chrome-extension://test/_favicon/");
    expect(faviconUrl("data:text/plain,a")).toBeUndefined();
    expect(faviconUrl("not a URL")).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
