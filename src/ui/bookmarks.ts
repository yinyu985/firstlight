import type { BookmarkItem } from "../shared/model";
import { parse } from "tldts";
import { toUnicode } from "punycode/";

export function getBookmarkTitle(item: BookmarkItem): string {
  if (item.title.trim()) return item.title;
  if (!item.url) return "UNTITLED";
  try {
    const hostname = new URL(item.url).hostname.replace(/\.$/, "");
    if (!hostname) return item.url;
    const domain = parse(hostname, { allowPrivateDomains: true });
    // Only shorten recognized suffixes; custom/internal hosts retain their identity.
    const title = (domain.isIcann || domain.isPrivate) && domain.publicSuffix !== "home.arpa" ? domain.domainWithoutSuffix || hostname : hostname;
    return toUnicode(title);
  } catch {
    return item.url;
  }
}

export interface SearchResult {
  item: BookmarkItem & { url: string };
  path: string;
}

export interface BookmarkIndexEntry extends SearchResult {
  searchable: string;
}

export function createBookmarkIndex(nodes: BookmarkItem[]): BookmarkIndexEntry[] {
  const entries: BookmarkIndexEntry[] = [];
  const walk = (items: BookmarkItem[], path: string) => {
    for (const item of items) {
      if (item.url !== undefined) {
        entries.push({
          item: item as SearchResult["item"],
          path: path || "Bookmarks bar",
          searchable: `${getBookmarkTitle(item)}\n${item.url}\n${path}`.toLocaleLowerCase()
        });
      } else {
        const title = getBookmarkTitle(item);
        walk(item.children ?? [], path ? `${path} / ${title}` : title);
      }
    }
  };
  walk(nodes, "");
  return entries;
}

export function searchBookmarkIndex(index: BookmarkIndexEntry[], query: string, limit = 80): { results: SearchResult[]; truncated: boolean } {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return { results: [], truncated: false };
  const results: SearchResult[] = [];
  for (const entry of index) {
    if (!entry.searchable.includes(normalized)) continue;
    if (results.length === limit) return { results, truncated: true };
    results.push(entry);
  }
  return { results, truncated: false };
}

const counts = new WeakMap<BookmarkItem[], number>();
export function countBookmarkUrls(nodes: BookmarkItem[]): number {
  const cached = counts.get(nodes);
  if (cached !== undefined) return cached;
  const count = nodes.reduce((total, item) => total + (item.url !== undefined ? 1 : countBookmarkUrls(item.children ?? [])), 0);
  counts.set(nodes, count);
  return count;
}

export function searchBookmarks(nodes: BookmarkItem[], query: string): SearchResult[] {
  return searchBookmarkIndex(createBookmarkIndex(nodes), query).results;
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
