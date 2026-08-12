const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "data:"]);

export function canOpenBookmark(url: string): boolean {
  const protocol = url.match(/^([a-z][a-z0-9+.-]*:)/i)?.[1].toLowerCase();
  return protocol ? OPENABLE_PROTOCOLS.has(protocol) : false;
}
