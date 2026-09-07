import type { Note, NoteSortMode } from "./types";

const NOTES_KEY = "firstlight.notes.v1";

export interface StoredNotesState {
  notes: Note[];
  sortMode: NoteSortMode;
  selectedNoteId: string | null;
}

const EMPTY_STATE: StoredNotesState = {
  notes: [],
  sortMode: "updated-desc",
  selectedNoteId: null
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidSortMode(value: unknown): value is NoteSortMode {
  return value === "updated-desc" || value === "created-desc";
}

function isValidNote(value: unknown): value is Note {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function parseState(raw: string | null): StoredNotesState {
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return EMPTY_STATE;

    const notes = Array.isArray(parsed.notes) ? parsed.notes.filter(isValidNote) : [];

    const sortMode = isValidSortMode(parsed.sortMode) ? parsed.sortMode : EMPTY_STATE.sortMode;

    const selectedNoteId = typeof parsed.selectedNoteId === "string" || parsed.selectedNoteId === null ? parsed.selectedNoteId : null;

    const selected = notes.some((note) => note.id === selectedNoteId);

    return {
      notes,
      sortMode,
      selectedNoteId: selected ? selectedNoteId : null
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function loadNotesState(): StoredNotesState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    return parseState(window.localStorage.getItem(NOTES_KEY));
  } catch {
    return EMPTY_STATE;
  }
}

export function saveNotesState(state: StoredNotesState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTES_KEY, JSON.stringify(state));
  } catch {
    // Storage may be disabled; notes remain available for the current session.
  }
}

export function saveNotesSortMode(sortMode: NoteSortMode): void {
  const current = loadNotesState();
  saveNotesState({ ...current, sortMode });
}

export function clearNotesState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(NOTES_KEY);
  } catch {
    // Nothing else can be cleared when storage access is denied.
  }
}
