import { describe, expect, it, vi } from "vitest";
import { countBookmarkUrls, createBookmarkIndex, faviconUrl, getBookmarkTitle, searchBookmarkIndex, searchBookmarks } from "./bookmarks";

describe("bookmark display titles", () => {
  it("preserves user titles and leaves unnamed folders with their existing fallback", () => {
    expect(getBookmarkTitle({ title: " 虎扑 ", url: "https://bbs.hupu.com/all-gambia" })).toBe(" 虎扑 ");
    expect(getBookmarkTitle({ title: "", children: [] })).toBe("UNTITLED");
  });

  it.each([
    ["https://bbs.hupu.com/all-gambia", "hupu"],
    ["https://www.google.com/search?q=hello", "google"],
    ["https://news.bbc.co.uk/world", "bbc"],
    ["https://bbs.example.com.cn/topic", "example"],
    ["https://bbs.hupu.com.:8443/topic", "hupu"],
    ["https://alice.github.io/page", "alice"],
    ["https://bob.github.io/page", "bob"],
    ["https://my-app.vercel.app", "my-app"],
    ["https://my-site.pages.dev", "my-site"],
    ["https://bucket.s3.amazonaws.com", "bucket"],
    ["https://docs.example.blogspot.com", "example"],
    ["https://foo.bar.example.co.jp", "example"],
    ["https://www.city.kawasaki.jp", "city"],
    ["https://a.b.ck", "a"],
    ["https://www.ck", "www"],
    ["https://co.uk", "co.uk"],
    ["https://api.example.newtld", "api.example.newtld"],
    ["http://api.service.internal", "api.service.internal"],
    ["http://api.team.local", "api.team.local"],
    ["http://nas.home.arpa", "nas.home.arpa"],
    ["http://foo.localhost", "foo.localhost"],
    ["https://例子.中国", "例子"],
    ["https://www.食狮.公司.cn", "食狮"],
    ["https://bücher.de", "bücher"],
    ["https://xn--bcher-kva.de", "bücher"],
    ["https://hupu.com.evil.com", "evil"],
    ["https://hupu.com@evil.com", "evil"],
    ["https://FOO.HUPU.COM.:443/path", "hupu"],
    ["http://192.168.1.10:8080/page", "192.168.1.10"],
    ["http://[::1]:8080/page", "[::1]"],
    ["http://localhost:3000", "localhost"],
    ["chrome://bookmarks", "bookmarks"],
    ["file:///tmp/document.html", "file:///tmp/document.html"],
    ["data:text/plain,hello", "data:text/plain,hello"],
    ["not a URL", "not a URL"]
  ])("uses the domain name or address for an unnamed bookmark at %s", (url, title) => {
    expect(getBookmarkTitle({ title: "", url })).toBe(title);
    expect(getBookmarkTitle({ title: " \t ", url })).toBe(title);
  });

  it("searches the displayed name without changing the stored bookmark title", () => {
    const item = { title: "", url: "https://bbs.hupu.com/all-gambia" };
    expect(searchBookmarks([item], "hupu")[0].item).toBe(item);
    expect(item.title).toBe("");
    const international = { title: "", url: "https://xn--bcher-kva.de" };
    expect(searchBookmarks([international], "bücher")[0].item).toBe(international);
  });
});

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
