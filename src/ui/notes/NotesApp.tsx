import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, Plus, Search, Trash2, X } from "lucide-react";
import { formatNoteDate, useNotes } from "./useNotes";
import type { NoteSortMode } from "./types";
import type { SyncNote } from "../../shared/model";

interface NotesSidebarProps {
  notes: {
    id: string;
    title: string;
    updatedAt: string;
  }[];
  selectedId: string | null;
  query: string;
  activeDeleteNoteId: string | null;
  onQueryChange: (value: string) => void;
  onSelect: (noteId: string) => void;
  onCreate: () => string;
  onStartDelete: (noteId: string) => void;
  onConfirmDelete: (noteId: string) => void;
  onCancelDelete: () => void;
  sortMode: NoteSortMode;
  onSortModeChange: (mode: NoteSortMode) => void;
  readonly?: boolean;
}

function NotesSidebar({
  notes,
  selectedId,
  query,
  activeDeleteNoteId,
  onQueryChange,
  onSelect,
  onCreate,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  sortMode,
  onSortModeChange,
  readonly = false
}: NotesSidebarProps) {
  const sortLabel = sortMode === "updated-desc" ? "Modified" : "Created";
  const sortNext: NoteSortMode = sortMode === "updated-desc" ? "created-desc" : "updated-desc";

  return (
    <aside className="notes-sidebar">
      <header className="notes-sidebar-header">
        <div className="notes-sidebar-title">
          <h2>Notes</h2>
          <button
            type="button"
            className="notes-sort-button"
            onClick={() => onSortModeChange(sortNext)}
            title={`Sort by ${sortNext === "updated-desc" ? "last modified" : "created"} time`}
          >
            <span className="notes-sort-label">{sortLabel}</span>
            <ArrowUpDown className="notes-sort-icon" size={15} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="notes-search-wrap">
        <Search className="notes-search-icon" size={17} strokeWidth={1.7} aria-hidden="true" />
        <input className="notes-search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="SEARCH NOTES" autoComplete="off" />
      </div>

      <div className="notes-list" role="list">
        {notes.length ? notes.map((note) => (
          <div key={note.id} role="listitem" className={`notes-item-wrap ${selectedId === note.id ? "is-active" : ""}`}>
            <button type="button" className="notes-item" onClick={() => onSelect(note.id)} onContextMenu={(event) => {
              event.preventDefault();
              if (!readonly) onStartDelete(note.id);
            }}>
              <span className="notes-item-title">{note.title || "New note"}</span>
              <span className="notes-item-time">{formatNoteDate(note.updatedAt)}</span>
            </button>
            {!readonly && (activeDeleteNoteId === note.id ? (
              <span className="notes-delete-confirm" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="notes-delete-btn notes-delete-confirm-btn notes-delete-confirm-yes" aria-label={`Confirm delete ${note.title || "new note"}`} onClick={() => onConfirmDelete(note.id)}>
                  <Check size={15} strokeWidth={1.7} aria-hidden="true" />
                </button>
                <button type="button" className="notes-delete-btn notes-delete-confirm-btn notes-delete-confirm-no" aria-label={`Cancel deleting ${note.title || "new note"}`} onClick={onCancelDelete}>
                  <X size={15} strokeWidth={1.7} aria-hidden="true" />
                </button>
              </span>
            ) : (
              <button type="button" className="notes-delete-btn" aria-label={`Delete ${note.title || "new note"}`} onClick={(event) => {
                event.stopPropagation();
                onStartDelete(note.id);
              }}>
                <Trash2 size={15} strokeWidth={1.7} aria-hidden="true" />
              </button>
            ))}
          </div>
        )) : <div className="notes-list-empty">No notes</div>}
      </div>

      {!readonly && <button type="button" className="notes-new-btn" onClick={onCreate} aria-label="Create new note">
        <Plus size={22} strokeWidth={1.8} aria-hidden="true" />
      </button>}
    </aside>
  );
}

function NotesEmptyState() {
  return (
    <section className="notes-editor notes-editor-empty">
      <div className="notes-editor-empty-inner">Create a new note</div>
    </section>
  );
}

interface NotesEditorProps {
  selectedId: string | null;
  title: string;
  content: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  createdAt: string;
  updatedAt: string;
  readonly?: boolean;
}

function NotesEditor({
  selectedId,
  title,
  content,
  onTitleChange,
  onContentChange,
  createdAt,
  updatedAt,
  readonly = false
}: NotesEditorProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    titleInputRef.current?.focus();
  }, [selectedId]);

  if (!selectedId) return <NotesEmptyState />;

  return (
    <section className="notes-editor">
      <input
        ref={titleInputRef}
        className="notes-title"
        value={title}
        placeholder="Untitled"
        onChange={(event) => onTitleChange(event.target.value)}
        aria-label="Note title"
        readOnly={readonly}
      />
      <div className="notes-divider" />
      <textarea
        className="notes-content"
        value={content}
        placeholder="Start writing..."
        onChange={(event) => onContentChange(event.target.value)}
        aria-label="Note content"
        readOnly={readonly}
      />
      <footer className="notes-meta">Last edited: {formatNoteDate(updatedAt)} · Created: {formatNoteDate(createdAt)}</footer>
    </section>
  );
}

interface NotesAppProps {
  initialNotes?: SyncNote[];
  onSave?: (notes: SyncNote[]) => void | Promise<void>;
  readonly?: boolean;
  externalResetKey?: number;
}

export interface NotesAppHandle {
  pausePersistence: () => void;
  resumePersistence: () => void;
}

export const NotesApp = forwardRef<NotesAppHandle, NotesAppProps>(function NotesApp({ initialNotes, onSave, readonly = false, externalResetKey }, ref) {
  const {
    filteredNotes,
    selectedNote,
    selectedNoteId,
    searchQuery,
    draftTitle,
    draftContent,
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
    hasNotes
  } = useNotes({ initialNotes, onSave, externalResetKey });

  useImperativeHandle(ref, () => ({ pausePersistence, resumePersistence }), [pausePersistence, resumePersistence]);

  const windowRef = useRef<HTMLDivElement>(null);
  const [activeDeleteNoteId, setActiveDeleteNoteId] = useState<string | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      if (windowRef.current && !windowRef.current.contains(document.activeElement)) windowRef.current.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, []);

  const startDeleteNote = (noteId: string) => {
    setActiveDeleteNoteId(noteId);
  };

  const cancelDeleteNote = () => {
    setActiveDeleteNoteId(null);
  };

  const confirmDeleteNote = (noteId: string) => {
    deleteNote(noteId);
    setActiveDeleteNoteId(null);
  };

  const listItems = useMemo(
    () => filteredNotes.map((note) => ({ id: note.id, title: note.title, updatedAt: note.updatedAt })),
    [filteredNotes]
  );

  useEffect(() => {
    if (!activeDeleteNoteId) return;
    if (!filteredNotes.some((note) => note.id === activeDeleteNoteId)) {
      setActiveDeleteNoteId(null);
    }
  }, [activeDeleteNoteId, filteredNotes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isEditable =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      const inNotesPanel = windowRef.current?.contains(event.target as Node) ?? false;
      if (!inNotesPanel || event.defaultPrevented) return;

      if (event.key === "Tab" && windowRef.current) {
        const focusable = Array.from(windowRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (isEditable) return;

      if (!readonly && (event.key === "Delete" || event.key === "Backspace")) {
        if (!selectedNoteId) return;
        if (activeDeleteNoteId === selectedNoteId) {
          event.preventDefault();
          confirmDeleteNote(selectedNoteId);
          return;
        }
        event.preventDefault();
        startDeleteNote(selectedNoteId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeDeleteNoteId, confirmDeleteNote, deleteNote, readonly, selectedNoteId, startDeleteNote]);

  return (
    <div className="notes-overlay">
      <div
        id="notes-app"
        className="notes-window"
        ref={windowRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notes"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => {
          if (!activeDeleteNoteId) return;
          const target = event.target as HTMLElement | null;
          if (!target) return;
          if (target.closest(".notes-delete-confirm") || target.closest(".notes-delete-btn")) return;
          cancelDeleteNote();
        }}
      >
        <NotesSidebar
          notes={listItems}
          selectedId={selectedNoteId}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSelect={(noteId) => {
            if (activeDeleteNoteId !== null) cancelDeleteNote();
            selectNote(noteId);
          }}
          activeDeleteNoteId={activeDeleteNoteId}
          onStartDelete={startDeleteNote}
          onConfirmDelete={confirmDeleteNote}
          onCancelDelete={cancelDeleteNote}
          sortMode={sortMode}
          onCreate={() => {
            if (activeDeleteNoteId !== null) cancelDeleteNote();
            return createNote();
          }}
          onSortModeChange={setSortMode}
          readonly={readonly}
        />

        {hasNotes ? (
          <NotesEditor
            selectedId={selectedNoteId}
            title={draftTitle}
            content={draftContent}
            onTitleChange={setDraftTitle}
            onContentChange={setDraftContent}
            createdAt={selectedNote?.createdAt ?? ""}
            updatedAt={selectedNote?.updatedAt ?? ""}
            readonly={readonly}
          />
        ) : <NotesEmptyState />}
      </div>
    </div>
  );
});
