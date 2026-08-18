export interface NoteContentStats {
  lines: number;
  characters: number;
  bytes: number;
  size: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) {
    const kilobytes = bytes / 1_024;
    return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
  }
  const megabytes = bytes / 1_024 ** 2;
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

export function getNoteContentStats(content: string): NoteContentStats {
  const bytes = new TextEncoder().encode(content).byteLength;
  return {
    lines: content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length,
    characters: Array.from(content).length,
    bytes,
    size: formatFileSize(bytes)
  };
}
