const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "data:"]);

export function canOpenBookmark(url: string): boolean {
  const protocol = url.match(/^([a-z][a-z0-9+.-]*:)/i)?.[1].toLowerCase();
  return protocol ? OPENABLE_PROTOCOLS.has(protocol) : false;
}

export interface PreparedBookmarkUrl {
  url: string;
  dispose?: () => void;
}

export function prepareBookmarkUrl(url: string): PreparedBookmarkUrl {
  if (!/^data:/i.test(url)) return { url };

  const separator = url.indexOf(",");
  if (separator < 0) return { url };

  try {
    const metadata = url.slice(5, separator);
    const payload = url.slice(separator + 1);
    const mimeType = metadata.split(";", 1)[0] || "text/plain;charset=US-ASCII";
    const bytes = /(?:^|;)base64(?:;|$)/i.test(metadata)
      ? Uint8Array.from(atob(decodeURIComponent(payload).replace(/\s/g, "")), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    return { url: objectUrl, dispose: () => URL.revokeObjectURL(objectUrl) };
  } catch {
    return { url };
  }
}
