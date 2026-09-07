type BookmarkNode = chrome.bookmarks.BookmarkTreeNode & { folderType?: string };

/** Chrome 134+ identifies permanent folders; older Chrome uses bar id "1". */
export function findBookmarkBar(tree: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode {
  const roots = (tree[0]?.children ?? []) as BookmarkNode[];
  const identified = roots.filter((node) => node.folderType === "bookmarks-bar");
  if (identified.length > 1) throw new Error("Chrome returned multiple bookmarks bars. Firstlight will not guess which one to replace.");
  const bar = identified[0] ?? roots.find((node) => node.id === "1" && node.folderType === undefined);
  if (!bar || bar.url !== undefined || bar.unmodifiable) throw new Error("Unable to locate an editable Chrome bookmarks bar");
  return bar;
}
