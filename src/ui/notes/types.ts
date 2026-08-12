export type NoteSortMode = "updated-desc" | "created-desc";

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteListFilters {
  searchQuery: string;
}
