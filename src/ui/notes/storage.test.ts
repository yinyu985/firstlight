// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNotesState, loadNotesState, saveNotesSortMode, saveNotesState } from "./storage";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe("Notes local preferences", () => {
  it("round-trips drafts, selection and sorting, and clears them explicitly", () => {
    const note = { id: "a", title: "Title", content: "Content", createdAt: "date", updatedAt: "date" };
    saveNotesState({ notes: [note], selectedNoteId: "a", sortMode: "updated-desc" });
    saveNotesSortMode("created-desc");
    expect(loadNotesState()).toEqual({ notes: [note], selectedNoteId: "a", sortMode: "created-desc" });
    clearNotesState();
    expect(loadNotesState().notes).toEqual([]);
  });
  it.each(["broken json", "null", JSON.stringify({ notes: [null, { id: 3 }], selectedNoteId: "missing", sortMode: "invalid" })])(
    "recovers from malformed preferences: %s",
    (raw) => {
      localStorage.setItem("firstlight.notes.v1", raw);
      expect(loadNotesState()).toEqual({ notes: [], selectedNoteId: null, sortMode: "updated-desc" });
    }
  );
  it("handles disabled local storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(loadNotesState().notes).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(() => saveNotesSortMode("created-desc")).not.toThrow();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(clearNotesState).not.toThrow();
  });
});
