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
  let bytes = 0;
  let characters = 0;
  let lines = content.length ? 1 : 0;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    characters += 1;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < content.length &&
      content.charCodeAt(index + 1) >= 0xdc00 &&
      content.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (code === 13 || (code === 10 && content.charCodeAt(index - 1) !== 13)) lines += 1;
  }
  return {
    lines,
    characters,
    bytes,
    size: formatFileSize(bytes)
  };
}
