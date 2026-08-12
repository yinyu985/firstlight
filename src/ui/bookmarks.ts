import type { BookmarkItem } from "../shared/model";

export interface SearchResult {
  item: BookmarkItem & { url: string };
  path: string;
}

export function searchBookmarks(nodes: BookmarkItem[], query: string): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const results: SearchResult[] = [];
  const walk = (items: BookmarkItem[], path: string[]) => {
    for (const item of items) {
      if (item.url !== undefined) {
        if (`${item.title}\n${item.url}\n${path.join(" / ")}`.toLocaleLowerCase().includes(normalized)) {
          results.push({ item: item as BookmarkItem & { url: string }, path: path.join(" / ") || "Bookmarks bar" });
        }
      } else {
        walk(item.children ?? [], [...path, item.title]);
      }
      if (results.length >= 80) return;
    }
  };
  walk(nodes, []);
  return results;
}

export function faviconUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return `chrome-extension://${chrome.runtime?.id ?? ""}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
  } catch {
    return undefined;
  }
}
