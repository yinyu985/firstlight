// @vitest-environment jsdom

import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncNote } from "../../shared/model";
import { SaveError } from "../../shared/saveError";
import { useNotes, type NotesHook } from "./useNotes";

const initialNotes: SyncNote[] = [
  {
    id: "a",
    name: "Alpha",
    content: "Alpha content",
    createtime: "2026-08-12T10:00:00.000+08:00",
    updatetime: "2026-08-12T10:00:00.000+08:00"
  },
  {
    id: "b",
    name: "Beta",
    content: "Beta content",
    createtime: "2026-08-12T09:00:00.000+08:00",
    updatetime: "2026-08-12T09:00:00.000+08:00"
  }
];

interface HarnessProps {
  notes: SyncNote[];
  onSave: (notes: SyncNote[]) => void | Promise<void>;
  report: (hook: NotesHook) => void;
  externalResetKey?: number;
}

function Harness({ notes, onSave, report, externalResetKey }: HarnessProps): ReactNode {
  report(useNotes({ initialNotes: notes, onSave, externalResetKey }));
  return null;
}

describe("useNotes", () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: NotesHook;
  let save: ReturnType<typeof vi.fn<(notes: SyncNote[]) => void>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T04:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    save = vi.fn<(notes: SyncNote[]) => void>();
    await act(async () => {
      root.render(
        <Harness
          notes={initialNotes}
          onSave={save}
          report={(hook) => {
            current = hook;
          }}
        />
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("keeps an edited note attached to its own id when selection changes", async () => {
    act(() => current.setDraftContent("Edited alpha"));
    act(() => current.selectNote("b"));

    await act(async () => vi.advanceTimersByTimeAsync(400));

    expect(current.notes.find((note) => note.id === "a")?.content).toBe("Edited alpha");
    expect(current.notes.find((note) => note.id === "b")?.content).toBe("Beta content");
    expect(save).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "a", content: "Edited alpha" }), expect.objectContaining({ id: "b", content: "Beta content" })])
    );
  });

  it("does not copy the previous note into a newly created note", () => {
    act(() => current.setDraftTitle("Edited alpha"));
    let createdId = "";
    act(() => {
      createdId = current.createNote();
    });

    expect(current.notes.find((note) => note.id === "a")?.title).toBe("Edited alpha");
    expect(current.notes.find((note) => note.id === createdId)).toMatchObject({ title: "", content: "" });
    expect(current.selectedNoteId).toBe(createdId);
  });

  it("selects a remaining note after deletion without changing its content", () => {
    act(() => current.selectNote("b"));
    act(() => current.deleteNote("b"));

    expect(current.selectedNoteId).toBe("a");
    expect(current.notes).toEqual([expect.objectContaining({ id: "a", content: "Alpha content" })]);
  });

  it("accepts an externally restored version of the selected note", async () => {
    const restored = initialNotes.map((note) => (note.id === "a" ? { ...note, content: "Remote alpha" } : note));
    await act(async () => {
      root.render(
        <Harness
          notes={restored}
          onSave={save}
          report={(hook) => {
            current = hook;
          }}
        />
      );
    });

    expect(current.selectedNoteId).toBe("a");
    expect(current.draftContent).toBe("Remote alpha");
  });

  it("flushes the latest edit when the Notes window closes before debounce", async () => {
    act(() => current.setDraftContent("Last keystroke"));
    await act(async () => root.unmount());

    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "a", content: "Last keystroke" })]));
    root = createRoot(container);
  });

  it("does not save an empty note list during the StrictMode effect probe", async () => {
    await act(async () => root.unmount());
    save.mockClear();
    root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <Harness
            notes={initialNotes}
            onSave={save}
            report={(hook) => {
              current = hook;
            }}
          />
        </StrictMode>
      );
    });

    expect(save).not.toHaveBeenCalled();
    expect(current.notes).toHaveLength(2);
  });

  it("does not let an earlier save echo overwrite newer typing", async () => {
    let resolveFirstSave: (() => void) | undefined;
    const pendingSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    const delayedSave = vi.fn((_notes: SyncNote[]) => pendingSave);

    await act(async () => {
      root.render(
        <Harness
          notes={initialNotes}
          onSave={delayedSave}
          report={(hook) => {
            current = hook;
          }}
        />
      );
    });
    act(() => current.setDraftContent("First edit"));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    const firstPayload = delayedSave.mock.calls[0]?.[0];
    expect(firstPayload).toBeDefined();

    act(() => current.setDraftContent("Newer edit"));
    await act(async () => {
      root.render(
        <Harness
          notes={firstPayload!}
          onSave={delayedSave}
          report={(hook) => {
            current = hook;
          }}
        />
      );
    });

    expect(current.draftContent).toBe("Newer edit");
    resolveFirstSave?.();
    await act(async () => Promise.resolve());
    await act(async () => {
      root.render(
        <Harness
          notes={structuredClone(firstPayload!)}
          onSave={delayedSave}
          report={(hook) => {
            current = hook;
          }}
        />
      );
    });
    expect(current.draftContent).toBe("Newer edit");
  });

  it("retries a failed note save without requiring another edit", async () => {
    const retryingSave = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          notes={initialNotes}
          onSave={retryingSave}
          report={(hook) => {
            current = hook;
          }}
        />
      );
    });
    act(() => current.setDraftContent("Retry me"));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(retryingSave).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(retryingSave).toHaveBeenCalledTimes(2);
    expect(retryingSave).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "a", content: "Retry me" })]));
  });

  it("selects the first note in the saved created-desc ordering on open", async () => {
    await act(async () => root.unmount());
    root = createRoot(container);
    localStorage.setItem("firstlight.notes.v1", JSON.stringify({ notes: [], sortMode: "created-desc", selectedNoteId: null }));
    const notes = [
      { ...initialNotes[0], createtime: "2026-08-11T10:00:00.000+08:00", updatetime: "2026-08-13T10:00:00.000+08:00" },
      { ...initialNotes[1], createtime: "2026-08-12T10:00:00.000+08:00" }
    ];
    await act(async () =>
      root.render(
        <Harness
          notes={notes}
          onSave={save}
          report={(hook) => {
            current = hook;
          }}
        />
      )
    );
    expect(current.sortMode).toBe("created-desc");
    expect(current.selectedNoteId).toBe("b");
    expect(current.filteredNotes[0].id).toBe("b");
  });

  it("does not retry permanent save errors until the user changes the draft", async () => {
    const rejected = vi.fn().mockRejectedValue(new SaveError("Invalid Notes", false));
    await act(async () =>
      root.render(
        <Harness
          notes={initialNotes}
          onSave={rejected}
          report={(hook) => {
            current = hook;
          }}
        />
      )
    );
    act(() => current.setDraftContent("Rejected draft"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(current.draftContent).toBe("Rejected draft");
    act(() => current.setDraftContent("Corrected draft"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(rejected).toHaveBeenCalledTimes(2);
  });

  it("forces the restored remote notes into the editor even when the parent value returns to an earlier version", async () => {
    act(() => current.setDraftContent("Unsaved local"));
    await act(async () => {
      root.render(
        <Harness
          notes={initialNotes}
          onSave={save}
          externalResetKey={1}
          report={(hook) => {
            current = hook;
          }}
        />
      );
    });

    expect(current.draftContent).toBe("Alpha content");
  });
});
