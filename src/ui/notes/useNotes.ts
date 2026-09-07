import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyncNote } from "../../shared/model";
import type { Note, NoteSortMode } from "./types";
import { clearNotesState, loadNotesState, saveNotesSortMode, saveNotesState, type StoredNotesState } from "./storage";

const DEFAULT_SORT_MODE: NoteSortMode = "updated-desc";
const AUTO_SAVE_MS = 350;

interface UseNotesOptions {
  initialNotes?: SyncNote[];
  onSave?: (notes: SyncNote[]) => void | Promise<void>;
  externalResetKey?: number;
}

function toEastEightTime(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function isValidSyncNote(value: unknown): value is SyncNote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.name === "string" &&
    typeof note.content === "string" &&
    typeof note.createtime === "string" &&
    typeof note.updatetime === "string"
  );
}

function toUiNote(note: SyncNote): Note {
  return {
    id: note.id,
    title: note.name,
    content: note.content,
    createdAt: note.createtime,
    updatedAt: note.updatetime
  };
}

function toSyncNote(note: Note): SyncNote {
  return {
    id: note.id,
    name: note.title,
    content: note.content,
    createtime: note.createdAt,
    updatetime: note.updatedAt
  };
}

function createNoteId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSortMode(mode?: string | null): NoteSortMode {
  return mode === "created-desc" ? "created-desc" : DEFAULT_SORT_MODE;
}

function getLatestNoteId(notes: Note[], sortMode: NoteSortMode): string | null {
  if (notes.length === 0) return null;
  return (
    [...notes].sort((a, b) => {
      if (sortMode === "created-desc") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0]?.id ?? null
  );
}

function sortNotes(notes: Note[], sortMode: NoteSortMode): Note[] {
  return [...notes].sort((a, b) => {
    if (sortMode === "created-desc") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export interface NotesHook {
  notes: Note[];
  filteredNotes: Note[];
  selectedNoteId: string | null;
  selectedNote: Note | null;
  searchQuery: string;
  draftTitle: string;
  draftContent: string;
  sortMode: NoteSortMode;
  setSearchQuery: (query: string) => void;
  setDraftTitle: (title: string) => void;
  setDraftContent: (content: string) => void;
  setSortMode: (sortMode: NoteSortMode) => void;
  createNote: () => string;
  selectNote: (noteId: string | null) => void;
  deleteNote: (noteId: string) => void;
  pausePersistence: () => void;
  resumePersistence: () => void;
  hasNotes: boolean;
  isReady: boolean;
}

export function useNotes(options: UseNotesOptions = {}): NotesHook {
  const { initialNotes, onSave, externalResetKey = 0 } = options;
  const [notes, setNotes] = useState<Note[]>([]);
  const [sortMode, setSortModeState] = useState<NoteSortMode>(() => normalizeSortMode(loadNotesState().sortMode));
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [persistenceRevision, setPersistenceRevision] = useState(0);
  const initialNotesVersionRef = useRef<string | null>(null);
  const savedNotesVersionRef = useRef<string | null>(null);
  const persistTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const inFlightVersionsRef = useRef(new Set<string>());
  const submittedVersionsRef = useRef(new Set<string>());
  const submittedVersionOrderRef = useRef<string[]>([]);
  const saveSequenceRef = useRef(0);
  const successfulSaveSequenceRef = useRef(0);
  const persistencePausedRef = useRef(false);
  const externalResetKeyRef = useRef(externalResetKey);
  const notesRef = useRef<Note[]>([]);
  const selectedNoteIdRef = useRef<string | null>(null);
  const readyRenderedRef = useRef(false);
  const onSaveRef = useRef(onSave);
  const initialNotesRef = useRef(initialNotes);
  const sortModeRef = useRef(sortMode);
  notesRef.current = notes;
  selectedNoteIdRef.current = selectedNoteId;
  onSaveRef.current = onSave;
  initialNotesRef.current = initialNotes;
  sortModeRef.current = sortMode;
  if (isReady) readyRenderedRef.current = true;

  useEffect(() => {
    if (initialNotes !== undefined) {
      const syncNotes = initialNotes.filter(isValidSyncNote).map(toUiNote);
      const version = JSON.stringify(initialNotes);
      const forcedReset = externalResetKey !== externalResetKeyRef.current;
      externalResetKeyRef.current = externalResetKey;
      if (version === initialNotesVersionRef.current && !forcedReset) return;
      initialNotesVersionRef.current = version;
      const currentVersion = JSON.stringify(notesRef.current.map(toSyncNote));
      const isOwnSaveEcho = submittedVersionsRef.current.has(version);
      savedNotesVersionRef.current = version;
      if (isOwnSaveEcho && currentVersion !== version && !persistencePausedRef.current && !forcedReset) {
        initialNotesVersionRef.current = currentVersion;
        setIsReady(true);
        return;
      }
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      if (persistencePausedRef.current || forcedReset) {
        inFlightVersionsRef.current.clear();
        submittedVersionsRef.current.clear();
        submittedVersionOrderRef.current = [];
      }
      persistencePausedRef.current = false;
      notesRef.current = syncNotes;
      setNotes(syncNotes);
      const currentSelection = selectedNoteIdRef.current;
      const nextSelection =
        currentSelection && syncNotes.some((note) => note.id === currentSelection) ? currentSelection : getLatestNoteId(syncNotes, DEFAULT_SORT_MODE);
      selectedNoteIdRef.current = nextSelection;
      setSelectedNoteId(nextSelection);
      setIsReady(true);
      return;
    }

    const stored: StoredNotesState = loadNotesState();
    const initialSortMode = normalizeSortMode(stored.sortMode);
    const seededNotes = [...stored.notes].sort((a, b) => {
      if (initialSortMode === "created-desc") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    notesRef.current = stored.notes;
    setNotes(stored.notes);
    setSortModeState(initialSortMode);

    const nextSelection =
      stored.selectedNoteId && seededNotes.some((note) => note.id === stored.selectedNoteId)
        ? stored.selectedNoteId
        : getLatestNoteId(seededNotes, initialSortMode);
    selectedNoteIdRef.current = nextSelection;
    setSelectedNoteId(nextSelection);
    setIsReady(true);
  }, [externalResetKey, initialNotes]);

  const orderedNotes = useMemo(() => sortNotes(notes, sortMode), [notes, sortMode]);

  const query = searchQuery.trim().toLowerCase();
  const filteredNotes = useMemo(() => {
    if (!query) return orderedNotes;
    return orderedNotes.filter((note) => {
      return note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query);
    });
  }, [orderedNotes, query]);

  const selectedNote = useMemo(() => {
    if (!selectedNoteId) return null;
    return notes.find((note) => note.id === selectedNoteId) ?? null;
  }, [notes, selectedNoteId]);

  useEffect(() => {
    if (!isReady || persistencePausedRef.current) return;

    if (!onSave) return;
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      const payload = notes.map(toSyncNote);
      const version = JSON.stringify(payload);
      if (version === savedNotesVersionRef.current || inFlightVersionsRef.current.has(version)) return;
      const sequence = ++saveSequenceRef.current;
      inFlightVersionsRef.current.add(version);
      if (!submittedVersionsRef.current.has(version)) {
        submittedVersionsRef.current.add(version);
        submittedVersionOrderRef.current.push(version);
        if (submittedVersionOrderRef.current.length > 20) {
          const oldest = submittedVersionOrderRef.current.shift();
          if (oldest !== undefined) submittedVersionsRef.current.delete(oldest);
        }
      }
      void Promise.resolve(onSave(payload))
        .then(() => {
          inFlightVersionsRef.current.delete(version);
          if (sequence >= successfulSaveSequenceRef.current) {
            successfulSaveSequenceRef.current = sequence;
            savedNotesVersionRef.current = version;
          }
        })
        .catch(() => {
          inFlightVersionsRef.current.delete(version);
          submittedVersionsRef.current.delete(version);
          submittedVersionOrderRef.current = submittedVersionOrderRef.current.filter((item) => item !== version);
          if (persistencePausedRef.current) return;
          if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            setPersistenceRevision((current) => current + 1);
          }, 1_000);
        });
    }, AUTO_SAVE_MS);
  }, [isReady, notes, onSave, persistenceRevision]);

  useEffect(() => {
    if (!isReady || onSave || initialNotes !== undefined) return;

    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }

    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      const selected = notes.some((note) => note.id === selectedNoteId) ? selectedNoteId : null;
      saveNotesState({ notes, sortMode, selectedNoteId: selected });
    }, 120);
  }, [initialNotes, isReady, notes, sortMode, selectedNoteId, onSave]);

  useEffect(
    () => () => {
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      if (!readyRenderedRef.current || persistencePausedRef.current) return;

      const latestNotes = notesRef.current;
      const latestOnSave = onSaveRef.current;
      if (latestOnSave) {
        const payload = latestNotes.map(toSyncNote);
        if (JSON.stringify(payload) !== savedNotesVersionRef.current) {
          void Promise.resolve(latestOnSave(payload)).catch(() => undefined);
        }
      } else if (initialNotesRef.current === undefined) {
        const selectedId = selectedNoteIdRef.current;
        const selected = latestNotes.some((note) => note.id === selectedId) ? selectedId : null;
        saveNotesState({ notes: latestNotes, sortMode: sortModeRef.current, selectedNoteId: selected });
      }
    },
    []
  );

  const updateSelectedNote = useCallback((field: "title" | "content", value: string) => {
    const selectedId = selectedNoteIdRef.current;
    if (!selectedId) return;
    const timestamp = toEastEightTime();
    setNotes((current) => {
      const next = current.map((note) => (note.id === selectedId && note[field] !== value ? { ...note, [field]: value, updatedAt: timestamp } : note));
      notesRef.current = next;
      return next;
    });
  }, []);

  const setDraftTitle = useCallback((title: string) => updateSelectedNote("title", title), [updateSelectedNote]);
  const setDraftContent = useCallback((content: string) => updateSelectedNote("content", content), [updateSelectedNote]);

  const createNote = useCallback(() => {
    const timestamp = toEastEightTime();
    const next: Note = {
      id: createNoteId(),
      title: "",
      content: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const updated = [next, ...notesRef.current];
    notesRef.current = updated;
    setNotes(updated);
    selectedNoteIdRef.current = next.id;
    setSelectedNoteId(next.id);
    return next.id;
  }, []);

  const selectNote = useCallback((noteId: string | null) => {
    selectedNoteIdRef.current = noteId;
    setSelectedNoteId(noteId);
  }, []);

  const setSortMode = useCallback((nextMode: NoteSortMode) => {
    setSortModeState(nextMode);
    saveNotesSortMode(nextMode);
  }, []);

  const deleteNote = useCallback((noteId: string) => {
    const remaining = notesRef.current.filter((note) => note.id !== noteId);
    notesRef.current = remaining;
    setNotes(remaining);
    if (noteId === selectedNoteIdRef.current) {
      const next = sortNotes(remaining, sortModeRef.current)[0]?.id ?? null;
      selectedNoteIdRef.current = next;
      setSelectedNoteId(next);
    }
  }, []);

  const pausePersistence = useCallback(() => {
    persistencePausedRef.current = true;
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const resumePersistence = useCallback(() => {
    persistencePausedRef.current = false;
    setPersistenceRevision((current) => current + 1);
  }, []);

  return {
    notes,
    filteredNotes,
    selectedNoteId,
    selectedNote,
    searchQuery,
    draftTitle: selectedNote?.title ?? "",
    draftContent: selectedNote?.content ?? "",
    sortMode,
    setSearchQuery,
    setDraftTitle,
    setDraftContent,
    setSortMode,
    createNote,
    selectNote,
    deleteNote,
    pausePersistence,
    resumePersistence,
    hasNotes: notes.length > 0,
    isReady
  };
}

export function clearAllNotes(): void {
  clearNotesState();
}

export function formatNoteDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}
