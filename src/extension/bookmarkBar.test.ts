import { describe, expect, it } from "vitest";
import { findBookmarkBar } from "./bookmarkBar";

type Node = chrome.bookmarks.BookmarkTreeNode & { folderType?: string };
const tree = (...children: Node[]): Node[] => [{ id: "0", title: "", children }];

describe("Chrome bookmarks bar selection", () => {
  it("finds the legacy bar by id rather than child order or localized title", () => {
    const bar = { id: "1", title: "书签栏", children: [] };
    expect(findBookmarkBar(tree({ id: "2", title: "Other bookmarks", children: [] }, bar))).toBe(bar);
  });
  it("uses Chrome's folder type when available", () => {
    const bar = { id: "99", folderType: "bookmarks-bar", title: "Account bookmarks", children: [] };
    expect(findBookmarkBar(tree({ id: "2", title: "Other", children: [] }, bar))).toBe(bar);
  });
  it("does not guess when Chrome returns multiple bars", () => {
    expect(() =>
      findBookmarkBar(
        tree({ id: "1", folderType: "bookmarks-bar", title: "Local", children: [] }, { id: "99", folderType: "bookmarks-bar", title: "Account", children: [] })
      )
    ).toThrow("multiple bookmarks bars");
  });
  it.each(
    [
      tree(),
      tree({ id: "2", title: "Not a bar", children: [] }),
      tree({ id: "1", title: "Managed", unmodifiable: "managed", children: [] }),
      tree({ id: "1", title: "Link", url: "https://example.test" }),
      tree({ id: "1", folderType: "other", title: "Other", children: [] })
    ].map((nodes) => ({ nodes }))
  )("rejects an absent, invalid or non-editable bar", ({ nodes }) => {
    expect(() => findBookmarkBar(nodes)).toThrow();
  });
});
