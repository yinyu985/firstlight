import type { DiffPayload, Snapshot } from "../shared/model";
import { prettySnapshot, serializeSnapshot } from "../shared/snapshot";

const MAX_DIFF_CHARACTERS = 250_000;
const MAX_DIFF_ITEMS = 2_500;

function metrics(snapshot: Snapshot) {
  let bookmarks = 0;
  let folders = 0;
  let characters = 0;
  const pending = [...snapshot.bookmarks];
  while (pending.length) {
    const item = pending.pop()!;
    characters += item.title.length + (item.url?.length ?? 0);
    if (item.url !== undefined) bookmarks += 1;
    else {
      folders += 1;
      for (const child of item.children ?? []) pending.push(child);
    }
  }
  for (const note of snapshot.notes) characters += note.name.length + note.content.length;
  return { bookmarks, folders, notes: snapshot.notes.length, characters };
}

export async function prepareDiffDocuments(diff: DiffPayload): Promise<{ left: string; right: string; summarized: boolean }> {
  const left = metrics(diff.left);
  const right = metrics(diff.right);
  const summarized = [left, right].some((item) => item.characters > MAX_DIFF_CHARACTERS || item.bookmarks + item.folders + item.notes > MAX_DIFF_ITEMS);
  if (summarized) {
    const summary = (snapshot: Snapshot, hash: string, stats: ReturnType<typeof metrics>) =>
      JSON.stringify(
        {
          preview: "Large snapshot: summary only. Download both originals to review all content before choosing.",
          sha256: hash,
          ...stats,
          config: snapshot.config
        },
        null,
        2
      );
    return { left: summary(diff.left, diff.leftHash, left), right: summary(diff.right, diff.rightHash, right), summarized };
  }
  const documents = await Promise.all([prettySnapshot(diff.left), prettySnapshot(diff.right)]);
  return { left: documents[0], right: documents[1], summarized };
}

export function downloadSnapshot(snapshot: Snapshot, name: string): void {
  const url = URL.createObjectURL(new Blob([serializeSnapshot(snapshot)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
