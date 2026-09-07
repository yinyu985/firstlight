import type { SyncNote } from "../../shared/model";
import { validateNotes } from "../../shared/snapshot";

const KEY = "firstlight.extension.pending-notes";

/** A single unacknowledged draft, not a version history or an Online cache. */
export function readPendingNotes(): SyncNote[] | undefined {
  const raw = localStorage.getItem(KEY);
  return raw === null ? undefined : validateNotes(JSON.parse(raw));
}

export function keepPendingNotes(notes: SyncNote[]): void {
  localStorage.setItem(KEY, JSON.stringify(notes));
}

export function clearPendingNotes(): void {
  localStorage.removeItem(KEY);
}
