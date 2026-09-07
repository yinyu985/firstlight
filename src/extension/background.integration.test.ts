import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, createDiffId, snapshotFrom, type BookmarkItem, type Snapshot, type SyncedSettings } from "../shared/model";
import type { ExtensionRequest, ExtensionResponse, StoredState } from "../shared/protocol";
import { snapshotHash } from "../shared/snapshot";
import { GitHubError, type RemoteSnapshot } from "../shared/gist";

const gistMock = vi.hoisted(() => ({
  discover: vi.fn(),
  read: vi.fn(),
  readForEncryptionUpgrade: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  rekey: vi.fn()
}));

vi.mock("../shared/gist", async () => {
  const actual = await vi.importActual<typeof import("../shared/gist")>("../shared/gist");
  class MockGistClient {
    discover = gistMock.discover;
    read = gistMock.read;
    readForEncryptionUpgrade = gistMock.readForEncryptionUpgrade;
    create = gistMock.create;
    update = gistMock.update;
    rekey = gistMock.rekey;
  }
  return { ...actual, GistClient: MockGistClient };
});

type MessageListener = (request: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: ExtensionResponse) => void) => boolean | undefined;

const LOCAL_TIME = "2026-08-20T17:00:00.000+08:00";
const REMOTE_TIME = "2026-08-20T09:01:00.000Z";

function remote(snapshot: Snapshot, updatedAt = REMOTE_TIME): RemoteSnapshot {
  return { gistId: "gist-1", htmlUrl: "https://gist.github.com/gist-1", updatedAt, snapshot };
}

function chromeMock(initialState: StoredState, initialBookmarks: BookmarkItem[] = []) {
  const messageListeners: MessageListener[] = [];
  const startupListeners: Array<() => void> = [];
  const alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void> = [];
  const storageValues: Record<string, unknown> = { firstlight: structuredClone(initialState) };
  const sessionValues: Record<string, unknown> = {};
  let nextBookmarkId = 10;
  let createFailures = 0;
  let failEveryCreate = false;

  const toTreeNodes = (items: BookmarkItem[]): chrome.bookmarks.BookmarkTreeNode[] =>
    items.map((item) => {
      const id = String(nextBookmarkId++);
      return item.url !== undefined
        ? { id, parentId: "1", index: 0, title: item.title, url: item.url }
        : { id, parentId: "1", index: 0, title: item.title, children: toTreeNodes(item.children ?? []) };
    });
  const bar: chrome.bookmarks.BookmarkTreeNode = {
    id: "1",
    parentId: "0",
    index: 0,
    title: "Bookmarks bar",
    children: toTreeNodes(initialBookmarks)
  };

  const findNode = (id: string, nodes = bar.children ?? []): chrome.bookmarks.BookmarkTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const nested = findNode(id, node.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  const removeNode = (id: string, nodes = bar.children ?? []): boolean => {
    const index = nodes.findIndex((node) => node.id === id);
    if (index >= 0) {
      nodes.splice(index, 1);
      return true;
    }
    return nodes.some((node) => removeNode(id, node.children ?? []));
  };
  const bookmarkItems = (nodes = bar.children ?? []): BookmarkItem[] =>
    nodes.map((node) => (node.url !== undefined ? { title: node.title, url: node.url } : { title: node.title, children: bookmarkItems(node.children ?? []) }));

  const storageSet = vi.fn(async (value: Record<string, unknown>) => {
    Object.assign(storageValues, structuredClone(value));
  });
  const bookmarkListeners = {
    created: vi.fn(),
    removed: vi.fn(),
    changed: vi.fn(),
    moved: vi.fn(),
    reordered: vi.fn()
  };
  const alarmsCreate = vi.fn(async () => undefined);
  const alarmsClear = vi.fn(async () => true);
  const bookmarksCreate = vi.fn(async (details: chrome.bookmarks.BookmarkCreateArg) => {
    if (failEveryCreate || createFailures > 0) {
      if (createFailures > 0) createFailures -= 1;
      throw new Error("simulated bookmark create failure");
    }
    const parent = details.parentId === "1" ? bar : findNode(details.parentId ?? "1");
    if (!parent) throw new Error("parent missing");
    parent.children ??= [];
    const node: chrome.bookmarks.BookmarkTreeNode = {
      id: String(nextBookmarkId++),
      parentId: parent.id,
      index: parent.children.length,
      title: details.title ?? "",
      ...(details.url !== undefined ? { url: details.url } : { children: [] })
    };
    parent.children.push(node);
    return structuredClone(node);
  });
  const api = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) =>
          Object.fromEntries(keys.filter((key) => key in storageValues).map((key) => [key, structuredClone(storageValues[key])]))
        ),
        set: storageSet
      },
      session: {
        get: vi.fn(async () => structuredClone(sessionValues)),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionValues, structuredClone(values));
        })
      }
    },
    bookmarks: {
      getTree: vi.fn(async () => [{ id: "0", title: "", children: [structuredClone(bar)] }]),
      getChildren: vi.fn(async (parentId: string) => structuredClone((parentId === "1" ? bar : findNode(parentId))?.children ?? [])),
      remove: vi.fn(async (id: string) => {
        removeNode(id);
      }),
      removeTree: vi.fn(async (id: string) => {
        removeNode(id);
      }),
      create: bookmarksCreate,
      onCreated: { addListener: bookmarkListeners.created },
      onRemoved: { addListener: bookmarkListeners.removed },
      onChanged: { addListener: bookmarkListeners.changed },
      onMoved: { addListener: bookmarkListeners.moved },
      onChildrenReordered: { addListener: bookmarkListeners.reordered }
    },
    alarms: {
      create: alarmsCreate,
      clear: alarmsClear,
      onAlarm: { addListener: vi.fn((listener: (alarm: chrome.alarms.Alarm) => void) => alarmListeners.push(listener)) }
    },
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn((listener: MessageListener) => messageListeners.push(listener)) },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn((listener: () => void) => startupListeners.push(listener)) }
    },
    action: { onClicked: { addListener: vi.fn() } },
    tabs: { create: vi.fn(async () => undefined) }
  };
  return {
    api,
    alarmListeners,
    alarmsCreate,
    bookmarkItems,
    bookmarkListeners,
    bookmarksCreate,
    getStored: (): StoredState => {
      const state = structuredClone(storageValues.firstlight) as StoredState & { storageVersion?: number };
      if (state.storageVersion === 2) {
        for (const field of ["notes", "pendingDiff", "recoveryPoints"])
          Object.assign(state, { [field]: structuredClone(storageValues[`firstlight.${field}`]) ?? undefined });
      }
      return state;
    },
    messageListeners,
    setCreateFailures: (count: number) => {
      createFailures = count;
    },
    setFailEveryCreate: (value: boolean) => {
      failEveryCreate = value;
    },
    startupListeners,
    storageSet
  };
}

async function sendRequest(listener: MessageListener, request: ExtensionRequest): Promise<ExtensionResponse> {
  return new Promise((resolve) => {
    expect(listener(request, {} as chrome.runtime.MessageSender, resolve)).toBe(true);
  });
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

async function flushImmediateTimers(): Promise<void> {
  await flushAsync();
  await vi.advanceTimersByTimeAsync(0);
  await flushAsync();
  await vi.advanceTimersByTimeAsync(0);
  await flushAsync();
}

async function connectedState(baselineSnapshot: Snapshot): Promise<StoredState> {
  const hash = await snapshotHash(baselineSnapshot);
  return {
    setupSeen: true,
    settings: baselineSnapshot.config,
    notes: [],
    localUpdatedAt: LOCAL_TIME,
    token: "token",
    gistId: "gist-1",
    gistUrl: "https://gist.github.com/gist-1",
    syncEnabled: true,
    baseline: { localHash: hash, remoteHash: hash, remoteUpdatedAt: REMOTE_TIME },
    sync: { phase: "synced", message: "Synced", gistId: "gist-1", remoteUpdatedAt: REMOTE_TIME }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
  gistMock.discover.mockReset().mockResolvedValue([]);
  gistMock.read.mockReset();
  gistMock.readForEncryptionUpgrade.mockReset();
  gistMock.create.mockReset();
  gistMock.rekey.mockReset();
  gistMock.update.mockReset().mockImplementation(async (gistId: string, snapshot: Snapshot) => ({
    ...remote(snapshot, "2026-08-20T09:02:00.000Z"),
    gistId
  }));
});

afterEach(async () => {
  vi.clearAllTimers();
  await flushAsync();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

describe("extension background integration", () => {
  it("does not replace an existing credential when the new token fails authentication", async () => {
    const local = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(local);
    const mock = chromeMock(state);
    vi.stubGlobal("chrome", mock.api);
    gistMock.discover.mockRejectedValue(new GitHubError("Bad credentials", 401));
    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "SAVE_TOKEN", token: "invalid" });
    expect(response.ok).toBe(false);
    expect(mock.getStored()).toMatchObject({ token: "token", gistId: "gist-1", baseline: state.baseline });
  });

  it("only changes storage preference when saving the same normalized token", async () => {
    const mock = chromeMock(await connectedState(snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME)));
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "SAVE_TOKEN", token: " ‘token’ ", rememberToken: false });
    expect(response.ok).toBe(true);
    expect(response.state?.token).toBe("token");
    expect(gistMock.discover).not.toHaveBeenCalled();
    expect(gistMock.rekey).not.toHaveBeenCalled();
  });

  it("journals a failed token rekey, blocks uploads and resumes after Worker restart", async () => {
    const local = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(local);
    const mock = chromeMock(state);
    vi.stubGlobal("chrome", mock.api);
    gistMock.discover.mockResolvedValue([remote(local)]);
    gistMock.read.mockRejectedValue(new (await import("../shared/notesEnvelope")).NotesDecryptionError());
    gistMock.rekey.mockImplementation(async (_gistId, _oldToken, beforeWrite) => {
      await beforeWrite();
      throw new GitHubError("offline", undefined, "network");
    });
    await import("./background");
    const failed = await sendRequest(mock.messageListeners[0], { type: "SAVE_TOKEN", token: "replacement", rememberToken: true });
    expect(failed.ok).toBe(false);
    expect(mock.getStored()).toMatchObject({
      token: "token",
      tokenMigration: { token: "replacement", gistId: "gist-1" },
      syncEnabled: false,
      baseline: state.baseline
    });
    expect((await sendRequest(mock.messageListeners[0], { type: "UPLOAD_NOW" })).ok).toBe(false);
    expect(gistMock.update).not.toHaveBeenCalled();
    vi.resetModules();
    gistMock.rekey.mockResolvedValue(remote(local));
    await import("./background");
    const resumed = await sendRequest(mock.messageListeners[1], { type: "SAVE_TOKEN", token: "replacement", rememberToken: true });
    expect(resumed.ok).toBe(true);
    expect(mock.getStored().token).toBe("replacement");
    expect(mock.getStored().tokenMigration).toBeUndefined();
    expect(gistMock.rekey).toHaveBeenLastCalledWith("gist-1", "token");
  });

  it("retains the migration journal if the final local connection commit fails", async () => {
    const local = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(local));
    vi.stubGlobal("chrome", mock.api);
    gistMock.discover.mockResolvedValue([remote(local)]);
    gistMock.read.mockRejectedValue(new (await import("../shared/notesEnvelope")).NotesDecryptionError());
    gistMock.rekey.mockImplementation(async (_gistId, _oldToken, beforeWrite) => {
      await beforeWrite();
      return remote(local);
    });
    await import("./background");
    const normal = mock.storageSet.getMockImplementation()!;
    mock.storageSet.mockImplementation(async (values) => {
      if ((values.firstlight as StoredState)?.token === "replacement") throw new Error("disk full");
      return normal(values);
    });
    const response = await sendRequest(mock.messageListeners[0], { type: "SAVE_TOKEN", token: "replacement", rememberToken: true });
    expect(response.ok).toBe(false);
    expect(mock.getStored()).toMatchObject({ token: "token", tokenMigration: { token: "replacement" }, syncEnabled: false });
  });

  it("does not overwrite local Notes or advance the baseline when decryption fails", async () => {
    const local = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(local);
    const mock = chromeMock(state);
    vi.stubGlobal("chrome", mock.api);
    gistMock.read.mockRejectedValue(new (await import("../shared/notesEnvelope")).NotesDecryptionError());
    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "UPLOAD_NOW" });
    expect(response.ok).toBe(false);
    expect(mock.getStored().baseline).toEqual(state.baseline);
    expect(mock.getStored().notes).toEqual(state.notes);
    expect(gistMock.update).not.toHaveBeenCalled();
  });
  it("upgrades legacy plaintext Notes only after an explicit upload", async () => {
    const local = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(local));
    vi.stubGlobal("chrome", mock.api);
    gistMock.read.mockRejectedValue(new (await import("../shared/notesEnvelope")).UnsupportedNotesFormatError());
    gistMock.readForEncryptionUpgrade.mockResolvedValue(remote(local));
    await import("./background");

    const response = await sendRequest(mock.messageListeners[0], { type: "UPLOAD_NOW" });

    expect(response.ok).toBe(true);
    expect(gistMock.readForEncryptionUpgrade).toHaveBeenCalledWith("gist-1");
    expect(gistMock.update).toHaveBeenCalledWith("gist-1", expect.objectContaining({ notes: [] }), expect.objectContaining({ gistId: "gist-1" }));
  });
  it("retries an automatic upload's failed baseline commit without advancing its baseline", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    const mock = chromeMock(state, [{ title: "New", url: "https://new.test" }]);
    const store = mock.storageSet.getMockImplementation()!;
    let failed = false;
    mock.storageSet.mockImplementation(async (value) => {
      const metadata = value.firstlight as StoredState;
      if (!failed && metadata.baseline && metadata.baseline.localHash !== state.baseline!.localHash) {
        failed = true;
        throw new Error("temporary baseline storage failure");
      }
      return store(value);
    });
    gistMock.read.mockResolvedValue(remote(baseline));
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await flushImmediateTimers();
    await vi.waitFor(() => expect(mock.getStored().pendingUpload?.attempts).toBe(1));
    expect(mock.getStored().baseline).toEqual(state.baseline);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(() => expect(mock.getStored().pendingUpload).toBeUndefined());
    expect(mock.getStored().baseline?.localHash).not.toBe(state.baseline!.localHash);
  });
  it("retains edits and their pending upload when an older network write finishes", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    const mock = chromeMock(state, [{ title: "First upload", url: "https://first.test" }]);
    let finish!: () => void;
    let uploaded!: Snapshot;
    gistMock.read.mockResolvedValue(remote(baseline));
    gistMock.update.mockImplementation((_id: string, snapshot: Snapshot) => {
      uploaded = snapshot;
      return new Promise<RemoteSnapshot>((resolve) => {
        finish = () => resolve(remote(snapshot));
      });
    });
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    const uploading = sendRequest(mock.messageListeners[0], { type: "UPLOAD_NOW" });
    await vi.waitFor(() => expect(finish).toBeDefined());
    const notes = [{ id: "new", name: "", content: "Typed while uploading", createtime: LOCAL_TIME, updatetime: LOCAL_TIME }];
    expect((await sendRequest(mock.messageListeners[0], { type: "SAVE_NOTES", notes })).ok).toBe(true);
    finish();
    expect((await uploading).ok).toBe(true);
    expect(mock.getStored().notes).toEqual(notes);
    expect(mock.getStored().baseline?.localHash).toBe(await snapshotHash(uploaded));
    expect(mock.getStored().pendingUpload).toBeDefined();
  });

  it("stops automatic retries for a permanent permission failure", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    const mock = chromeMock(state, [{ title: "Local", url: "https://local.test" }]);
    gistMock.read.mockRejectedValue(new GitHubError("Insufficient permission", 403));
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await flushImmediateTimers();
    await vi.waitFor(() => expect(mock.getStored().sync?.phase).toBe("error"));
    expect(mock.getStored().pendingUpload).toBeUndefined();
    const calls = gistMock.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gistMock.read).toHaveBeenCalledTimes(calls);
  });
  it("keeps the old baseline when committing a verified upload fails", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    const mock = chromeMock(state, [{ title: "New", url: "https://new.test" }]);
    const store = mock.storageSet.getMockImplementation()!;
    mock.storageSet.mockImplementation(async (value) => {
      const metadata = value.firstlight as StoredState;
      if (metadata.baseline && metadata.baseline.localHash !== state.baseline!.localHash) throw new Error("baseline commit failed");
      return store(value);
    });
    gistMock.read.mockResolvedValue(remote(baseline));
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "UPLOAD_NOW" });
    expect(response.ok).toBe(false);
    expect(mock.getStored().baseline).toEqual(state.baseline);
  });

  it("retains a restore journal when rollback metadata cannot be committed", async () => {
    const before = snapshotFrom([{ title: "Before", url: "https://before.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const target = snapshotFrom([{ title: "Target", url: "https://target.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(before), before.bookmarks);
    gistMock.read.mockResolvedValue(remote(target));
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    const comparison = await sendRequest(mock.messageListeners[0], { type: "COMPARE_REMOTE" });
    const store = mock.storageSet.getMockImplementation()!;
    let journalWritten = false;
    mock.storageSet.mockImplementation(async (value) => {
      const metadata = value.firstlight as StoredState;
      if (metadata.restoreJournal) journalWritten = true;
      if (journalWritten && !metadata.restoreJournal) throw new Error("journal commit failed");
      return store(value);
    });
    mock.setCreateFailures(1);
    const result = await sendRequest(mock.messageListeners[0], { type: "USE_REMOTE", diffId: comparison.state!.diff!.id });
    expect(result.error).toContain("Rollback also failed");
    expect(mock.getStored().restoreJournal).toBeDefined();
    expect(mock.bookmarkItems()).toEqual(before.bookmarks);
  });

  it("preserves malformed recovery evidence and refuses remote operations", async () => {
    const journal = { recoveryPointId: "missing", targetHash: "a".repeat(64), startedAt: "2026-08-20T09:00:00Z" };
    const points = [{ id: "damaged", snapshot: { notes: "raw evidence" } }] as never;
    const mock = chromeMock({ setupSeen: true, token: "token", syncEnabled: true, restoreJournal: journal, recoveryPoints: points });
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    expect(mock.getStored().restoreJournal).toEqual(journal);
    expect(mock.getStored().recoveryPoints).toEqual(points);
    expect((await sendRequest(mock.messageListeners[0], { type: "UPLOAD_NOW" })).ok).toBe(false);
    expect(gistMock.read).not.toHaveBeenCalled();
  });

  it("saves local Notes and settings while a remote read is pending, then compares the latest state", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(baseline));
    let finish!: (value: RemoteSnapshot) => void;
    gistMock.read.mockImplementation(
      () =>
        new Promise<RemoteSnapshot>((resolve) => {
          finish = resolve;
        })
    );
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    const comparing = sendRequest(mock.messageListeners[0], { type: "COMPARE_REMOTE" });
    await vi.waitFor(() => expect(finish).toBeDefined());
    const notes = [{ id: "a", name: "New", content: "Saved during network wait", createtime: LOCAL_TIME, updatetime: LOCAL_TIME }];
    expect((await sendRequest(mock.messageListeners[0], { type: "SAVE_NOTES", notes })).ok).toBe(true);
    const settings = { ...DEFAULT_SETTINGS, foreground: { ...DEFAULT_SETTINGS.foreground, fontSize: 18 } };
    expect((await sendRequest(mock.messageListeners[0], { type: "SAVE_SETTINGS", settings })).ok).toBe(true);
    expect(mock.getStored().notes).toEqual(notes);
    finish(remote(baseline));
    const result = await comparing;
    expect(result.state?.diff?.left.notes).toEqual(notes);
    expect(mock.getStored().pendingUpload).toBeUndefined();
    await sendRequest(mock.messageListeners[0], { type: "SAVE_NOTES", notes: [{ ...notes[0], content: "Still conflicting" }] });
    expect(mock.getStored().pendingUpload).toBeUndefined();
  });

  it("does not repeat a successful startup check after a Worker restart in the same session", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(baseline));
    gistMock.read.mockResolvedValue(remote(baseline));
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await flushImmediateTimers();
    await vi.waitFor(() => expect(mock.api.storage.session.set).toHaveBeenCalledWith({ "firstlight.startup-checked": true }));
    const calls = gistMock.read.mock.calls.length;
    vi.resetModules();
    await import("./background");
    await sendRequest(mock.messageListeners[1], { type: "GET_STATE" });
    await flushImmediateTimers();
    expect(gistMock.read).toHaveBeenCalledTimes(calls);
  });

  it("ignores bookmark events that do not change the bookmark bar", async () => {
    const mock = chromeMock({ setupSeen: true }, [{ title: "Same", url: "https://same.test" }]);
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    mock.storageSet.mockClear();
    mock.api.runtime.sendMessage.mockClear();
    mock.bookmarkListeners.changed.mock.calls[0][0]("other-bookmark", {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.storageSet).not.toHaveBeenCalled();
    expect(mock.api.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it("registers Chrome listeners and answers GET_STATE through the runtime boundary", async () => {
    const mock = chromeMock({ setupSeen: true });
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    expect(mock.messageListeners).toHaveLength(1);
    const response = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });

    expect(response.ok).toBe(true);
    expect(response.state).toMatchObject({ target: "extension", bookmarks: [], notes: [] });
    expect(Object.values(mock.bookmarkListeners).every((listener) => listener.mock.calls.length === 1)).toBe(true);
    expect(mock.alarmListeners).toHaveLength(1);
  });

  it("preserves malformed stored Notes by failing initialization before any write", async () => {
    const mock = chromeMock({ setupSeen: true, notes: [{ id: "damaged", content: 42 }] as never });
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });

    expect(response.ok).toBe(false);
    expect(response.error).toContain("Stored Notes are invalid and were left unchanged");
    expect(mock.storageSet).not.toHaveBeenCalled();
  });

  it("does not treat settings key order as corruption", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.settingsVersion = 1;
    state.settings = Object.fromEntries(Object.entries(baseline.config).sort(([left], [right]) => left.localeCompare(right))) as unknown as SyncedSettings;
    const originalBaseline = structuredClone(state.baseline);
    const mock = chromeMock(state);
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });

    expect(response.ok).toBe(true);
    expect(response.state?.settings).toEqual(baseline.config);
    expect(response.state?.toast).toBeUndefined();
    expect(mock.getStored().baseline).toEqual(originalBaseline);
    expect(mock.storageSet).not.toHaveBeenCalled();
  });

  it("repairs only an invalid feature field and reports a field repair", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.settingsVersion = 1;
    state.settings = {
      ...baseline.config,
      openTarget: "current-tab",
      features: { ...baseline.config.features, searchIcon: "invalid" as never }
    };
    const mock = chromeMock(state);
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });

    expect(response.ok).toBe(true);
    expect(response.state?.settings).toMatchObject({
      openTarget: "current-tab",
      features: { searchIcon: DEFAULT_SETTINGS.features.searchIcon }
    });
    expect(response.state?.toast?.message).toBe("Some stored settings were invalid and were repaired (features.searchIcon)");
    expect(mock.getStored().baseline).toBeUndefined();
  });

  it("resets settings only when the stored root value is unreadable", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.settingsVersion = 1;
    state.settings = "damaged" as never;
    const mock = chromeMock(state);
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });

    expect(response.ok).toBe(true);
    expect(response.state?.settings).toEqual(snapshotFrom([], DEFAULT_SETTINGS).config);
    expect(response.state?.toast?.message).toBe("Stored settings were invalid and were reset to safe defaults");
    expect(mock.getStored().baseline).toBeUndefined();
  });

  it("treats manual UPLOAD as an explicit local-priority overwrite", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const localBookmarks = [{ title: "Local", url: "https://local.example" }];
    const remoteSnapshot = snapshotFrom([{ title: "Remote", url: "https://remote.example" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(baseline), localBookmarks);
    gistMock.read.mockResolvedValue(remote(remoteSnapshot, "2026-08-20T09:03:00.000Z"));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    const response = await sendRequest(mock.messageListeners[0], { type: "UPLOAD_NOW" });

    expect(response.ok).toBe(true);
    expect(gistMock.update).toHaveBeenCalledTimes(1);
    expect(gistMock.update.mock.calls[0]?.[1]).toMatchObject({ bookmarks: localBookmarks });
    expect(response.state?.diff).toBeUndefined();
    expect(response.state?.sync.phase).toBe("synced");
  });

  it("keeps startup checks read-only and opens Diff for a local-only difference", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const localBookmarks = [{ title: "Local", url: "https://local.example" }];
    const mock = chromeMock(await connectedState(baseline), localBookmarks);
    gistMock.read.mockResolvedValue(remote(baseline));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await flushImmediateTimers();
    // WebCrypto runs outside fake timers; wait for the queued check to commit.
    await vi.waitFor(() => expect(mock.getStored().sync?.phase).toBe("conflict"));

    expect(gistMock.update).not.toHaveBeenCalled();
    expect(mock.getStored().pendingDiff).toMatchObject({
      left: { bookmarks: localBookmarks },
      right: { bookmarks: [] }
    });
    expect(mock.getStored().sync?.phase).toBe("conflict");
  });

  it("restores a reviewed remote snapshot and clears the restore journal after verification", async () => {
    const local = snapshotFrom([{ title: "Before", url: "https://before.example" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const target = snapshotFrom([{ title: "After", url: "https://after.example" }], DEFAULT_SETTINGS, [], "2026-08-20T17:05:00.000+08:00");
    const targetRemote = remote(target, "2026-08-20T09:05:00.000Z");
    const leftHash = await snapshotHash(local);
    const rightHash = await snapshotHash(target);
    const state = await connectedState(local);
    state.pendingDiff = {
      id: createDiffId("remote", leftHash, rightHash, targetRemote.updatedAt),
      source: "remote",
      leftHash,
      rightHash,
      gistId: targetRemote.gistId,
      remoteUpdatedAt: targetRemote.updatedAt,
      left: local,
      right: target
    };
    state.sync = { phase: "conflict", message: "Choose", gistId: "gist-1", remoteUpdatedAt: targetRemote.updatedAt };
    const mock = chromeMock(state, local.bookmarks);
    gistMock.read.mockResolvedValue(targetRemote);
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    const response = await sendRequest(mock.messageListeners[0], { type: "USE_REMOTE", diffId: state.pendingDiff.id });

    expect(response.ok).toBe(true);
    expect(mock.bookmarkItems()).toEqual(target.bookmarks);
    expect(mock.getStored().restoreJournal).toBeUndefined();
    expect(mock.getStored().recoveryPoints).toEqual([expect.objectContaining({ snapshot: expect.objectContaining({ bookmarks: local.bookmarks }) })]);
    expect(response.state?.sync.phase).toBe("synced");
  });

  it("reports a startup storage failure without dropping the error notification", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.settingsVersion = 1;
    const mock = chromeMock(state);
    gistMock.read.mockRejectedValue(new Error("Remote unavailable"));
    mock.storageSet.mockRejectedValue(new Error("Storage unavailable"));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await vi.waitFor(() =>
      expect(mock.api.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({ sync: expect.objectContaining({ phase: "error" }) })
        })
      )
    );
    expect(gistMock.update).not.toHaveBeenCalled();
  });

  it("rolls back a failed restore before returning an error", async () => {
    const local = snapshotFrom([{ title: "Before", url: "https://before.example" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const target = snapshotFrom([{ title: "After", url: "https://after.example" }], DEFAULT_SETTINGS, [], "2026-08-20T17:05:00.000+08:00");
    const targetRemote = remote(target, "2026-08-20T09:05:00.000Z");
    const leftHash = await snapshotHash(local);
    const rightHash = await snapshotHash(target);
    const state = await connectedState(local);
    state.pendingDiff = {
      id: createDiffId("remote", leftHash, rightHash, targetRemote.updatedAt),
      source: "remote",
      leftHash,
      rightHash,
      gistId: "gist-1",
      remoteUpdatedAt: targetRemote.updatedAt,
      left: local,
      right: target
    };
    const mock = chromeMock(state, local.bookmarks);
    mock.setCreateFailures(1);
    gistMock.read.mockResolvedValue(targetRemote);
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    const response = await sendRequest(mock.messageListeners[0], { type: "USE_REMOTE", diffId: state.pendingDiff.id });

    expect(response.ok).toBe(false);
    expect(response.error).toContain("rolled back");
    expect(mock.bookmarkItems()).toEqual(local.bookmarks);
    expect(mock.getStored().restoreJournal).toBeUndefined();
    expect(mock.getStored().syncEnabled).toBe(true);
  });

  it("retains the restore journal and disables sync when rollback also fails", async () => {
    const local = snapshotFrom([{ title: "Before", url: "https://before.example" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const target = snapshotFrom([{ title: "After", url: "https://after.example" }], DEFAULT_SETTINGS, [], "2026-08-20T17:05:00.000+08:00");
    const targetRemote = remote(target, "2026-08-20T09:05:00.000Z");
    const leftHash = await snapshotHash(local);
    const rightHash = await snapshotHash(target);
    const state = await connectedState(local);
    state.pendingDiff = {
      id: createDiffId("remote", leftHash, rightHash, targetRemote.updatedAt),
      source: "remote",
      leftHash,
      rightHash,
      gistId: "gist-1",
      remoteUpdatedAt: targetRemote.updatedAt,
      left: local,
      right: target
    };
    const mock = chromeMock(state, local.bookmarks);
    mock.setFailEveryCreate(true);
    gistMock.read.mockResolvedValue(targetRemote);
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    const response = await sendRequest(mock.messageListeners[0], { type: "USE_REMOTE", diffId: state.pendingDiff.id });

    expect(response.ok).toBe(false);
    expect(response.error).toContain("Rollback also failed");
    expect(mock.getStored()).toMatchObject({
      syncEnabled: false,
      sync: { phase: "error", message: expect.stringContaining("Rollback also failed") },
      restoreJournal: { targetHash: rightHash }
    });
    expect(mock.getStored().baseline).toBeUndefined();
    expect(mock.getStored().pendingDiff).toBeUndefined();
  });

  it("uses the persisted restore journal before exposing state after a worker restart", async () => {
    const before = snapshotFrom([{ title: "Before", url: "https://before.example" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const target = snapshotFrom([{ title: "Target", url: "https://target.example" }], DEFAULT_SETTINGS, [], "2026-08-20T17:05:00.000+08:00");
    const state = await connectedState(before);
    state.recoveryPoints = [{ id: "point-1", createdAt: "2026-08-20T09:00:00.000Z", reason: "manual-restore", snapshot: before }];
    state.restoreJournal = { recoveryPointId: "point-1", targetHash: await snapshotHash(target), startedAt: "2026-08-20T09:00:00.000Z" };
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    state.sync = { phase: "restoring", message: "Restoring bookmarks…", gistId: "gist-1" };
    const partial = [{ title: "Partial", url: "https://partial.example" }];
    const mock = chromeMock(state, partial);
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });

    expect(response.ok).toBe(true);
    expect(response.state?.bookmarks).toEqual(before.bookmarks);
    expect(response.state?.sync).toMatchObject({ phase: "error", message: expect.stringContaining("rolled back") });
    expect(mock.getStored().restoreJournal).toBeUndefined();
    expect(mock.getStored().pendingUpload).toBeUndefined();
    expect(gistMock.update).not.toHaveBeenCalled();
  });

  it("persists a debounced upload and arms both worker and Chrome alarm scheduling", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(baseline));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    const nextSettings = { ...DEFAULT_SETTINGS, openTarget: "current-tab" as const };
    const response = await sendRequest(mock.messageListeners[0], { type: "SAVE_SETTINGS", settings: nextSettings });

    expect(response.ok).toBe(true);
    expect(mock.getStored().pendingUpload).toEqual({ dueAt: Date.now() + 10_000, attempts: 0 });
    expect(mock.alarmsCreate).toHaveBeenLastCalledWith("firstlight-pending-upload", { when: Date.now() + 10_000 });
  });

  it("resumes an overdue persisted upload and clears it only after a verified write", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const localBookmarks = [{ title: "Local", url: "https://local.example" }];
    const state = await connectedState(baseline);
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    const mock = chromeMock(state, localBookmarks);
    gistMock.read.mockResolvedValue(remote(baseline));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    vi.clearAllTimers();
    mock.alarmListeners[0]({ name: "firstlight-pending-upload", scheduledTime: Date.now() });
    await flushAsync();

    await vi.waitFor(() => expect(gistMock.update).toHaveBeenCalledTimes(1));
    expect(gistMock.update).toHaveBeenCalledTimes(1);
    expect(gistMock.update.mock.calls[0]?.[1]).toMatchObject({ bookmarks: localBookmarks });
    await vi.waitFor(() => expect(mock.getStored().pendingUpload).toBeUndefined());
    expect(mock.getStored().pendingUpload).toBeUndefined();
    expect(mock.getStored().sync?.phase).toBe("synced");
  });

  it.each([REMOTE_TIME, "2026-08-20T09:05:00.000Z"])("turns a pending automatic upload into Diff when remote content changed at %s", async (remoteTime) => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const changedRemote = snapshotFrom([{ title: "Remote", url: "https://remote.example" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    const mock = chromeMock(state);
    gistMock.read.mockResolvedValue(remote(changedRemote, remoteTime));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await flushImmediateTimers();
    await vi.waitFor(() => expect(mock.getStored().sync?.phase).toBe("conflict"));

    expect(gistMock.update).not.toHaveBeenCalled();
    expect(mock.getStored().pendingUpload).toBeUndefined();
    expect(mock.getStored().pendingDiff).toMatchObject({ right: { bookmarks: changedRemote.bookmarks } });
  });

  it("refuses USE_LOCAL when the remote changed after the user reviewed the diff", async () => {
    const local = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const first = snapshotFrom([{ title: "Remote one", url: "https://one.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const second = snapshotFrom([{ title: "Remote two", url: "https://two.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(local));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);
    gistMock.read.mockResolvedValue(remote(first));
    await import("./background");
    const comparison = await sendRequest(mock.messageListeners[0], { type: "COMPARE_REMOTE" });
    gistMock.read.mockResolvedValue(remote(second));
    const response = await sendRequest(mock.messageListeners[0], { type: "USE_LOCAL", diffId: comparison.state!.diff!.id });
    expect(response.ok).toBe(false);
    expect(response.error).toContain("out of date");
    expect(gistMock.update).not.toHaveBeenCalled();
    expect(response.state?.diff?.right.bookmarks).toEqual(second.bookmarks);
  });

  it("keeps a failed automatic upload pending with bounded backoff", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    const mock = chromeMock(state, [{ title: "Local", url: "https://local.example" }]);
    gistMock.read.mockRejectedValue(new GitHubError("temporary network failure", undefined, "network"));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await flushImmediateTimers();

    await vi.waitFor(() => expect(mock.getStored().pendingUpload?.attempts).toBe(1));
    const expectedRetryAt = new Date("2026-08-20T09:00:20.000Z").getTime();
    expect(mock.getStored().pendingUpload).toEqual({ dueAt: expectedRetryAt, attempts: 1 });
    expect(mock.getStored().sync).toMatchObject({ phase: "error", message: "temporary network failure" });
    expect(mock.alarmsCreate).toHaveBeenLastCalledWith("firstlight-pending-upload", { when: expectedRetryAt });
  });
});

describe("worker and restore failure regressions", () => {
  it("returns the local homepage before reading a deferred comparison and gates uploads until it is validated", async () => {
    const local = snapshotFrom([{ title: "Local", url: "https://local.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const target = snapshotFrom([{ title: "Remote", url: "https://remote.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const leftHash = await snapshotHash(local);
    const rightHash = await snapshotHash(target);
    const diff = {
      id: createDiffId("remote", leftHash, rightHash, REMOTE_TIME),
      source: "remote",
      leftHash,
      rightHash,
      gistId: "gist-1",
      remoteUpdatedAt: REMOTE_TIME,
      left: local,
      right: target
    };
    const state = await connectedState(local);
    const mock = chromeMock(state, local.bookmarks);
    await mock.storageSet({
      firstlight: { ...state, storageVersion: 2, setupSeen: false, pendingUpload: { dueAt: Date.now(), attempts: 0 } },
      "firstlight.notes": [],
      "firstlight.pendingDiff": diff
    });
    const read = mock.api.storage.local.get.getMockImplementation()!;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.api.storage.local.get.mockImplementation(async (keys) => {
      if (keys.includes("firstlight.pendingDiff")) await blocked;
      return read(keys);
    });
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    const initial = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    expect(initial.ok).toBe(true);
    expect(initial.state?.bookmarks).toEqual(local.bookmarks);
    expect(initial.state?.diff).toBeUndefined();
    await flushImmediateTimers();
    expect(gistMock.read).not.toHaveBeenCalled();
    expect(mock.getStored().pendingDiff).toEqual(diff);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let releaseHash!: () => void;
    const hashBlocked = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const hashing = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => {
      await hashBlocked;
      return digest(...args);
    });
    const editing = sendRequest(mock.messageListeners[0], { type: "SAVE_SETTINGS", settings: { ...DEFAULT_SETTINGS, openTarget: "current-tab" } });
    release();
    await vi.waitFor(() => expect(hashing).toHaveBeenCalled());
    const duringValidation = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    expect(duringValidation.state?.diff).toBeUndefined();
    releaseHash();
    const edited = await editing;
    expect(edited.ok).toBe(true);
    expect(edited.state?.diff?.right).toEqual(target);
    expect(edited.state?.diff?.left.config.openTarget).toBe("current-tab");
    expect(mock.getStored().pendingUpload).toBeUndefined();
    expect(gistMock.update).not.toHaveBeenCalled();
  });

  it("schedules a bookmark change that wakes a fresh worker", async () => {
    const base = snapshotFrom([{ title: "Before", url: "https://example.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const mock = chromeMock(await connectedState(base), [{ title: "After", url: "https://example.test" }]);
    vi.stubGlobal("chrome", mock.api);
    gistMock.read.mockResolvedValue(remote(base));
    await import("./background");
    mock.bookmarkListeners.changed.mock.calls[0][0]("10", { title: "After" });
    await vi.advanceTimersByTimeAsync(200);
    await flushAsync();
    await vi.waitFor(() => expect(mock.getStored().pendingUpload).toBeDefined());
  });
  it("surfaces an invalid restore journal in a fresh toast", async () => {
    const base = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const stored = await connectedState(base);
    stored.restoreJournal = { recoveryPointId: "missing", targetHash: "0".repeat(64), startedAt: new Date().toISOString() };
    const mock = chromeMock(stored);
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    const response = await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    expect(response.state?.toast?.message).toContain("Interrupted restore");
  });
  it("rolls back a restore if its final baseline commit fails", async () => {
    const local = snapshotFrom([{ title: "Before", url: "https://before.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const target = snapshotFrom([{ title: "After", url: "https://after.test" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(local);
    const leftHash = await snapshotHash(local),
      rightHash = await snapshotHash(target);
    state.pendingDiff = {
      id: createDiffId("remote", leftHash, rightHash, REMOTE_TIME),
      source: "remote",
      leftHash,
      rightHash,
      gistId: "gist-1",
      remoteUpdatedAt: REMOTE_TIME,
      left: local,
      right: target
    };
    const mock = chromeMock(state, local.bookmarks);
    gistMock.read.mockResolvedValue(remote(target));
    vi.stubGlobal("chrome", mock.api);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    const normalSave = mock.storageSet.getMockImplementation()!;
    let failed = false;
    mock.storageSet.mockImplementation(async (values) => {
      const m = values.firstlight as StoredState | undefined;
      if (!failed && m?.baseline?.localHash === rightHash) {
        failed = true;
        throw new Error("baseline disk failure");
      }
      return normalSave(values);
    });
    const response = await sendRequest(mock.messageListeners[0], { type: "USE_REMOTE", diffId: state.pendingDiff.id });
    expect(response.ok).toBe(false);
    expect(response.error).toContain("rolled back");
    expect(mock.bookmarkItems()).toEqual(local.bookmarks);
    expect(mock.getStored().baseline?.localHash).toBe(leftHash);
    expect(mock.getStored().restoreJournal).toBeUndefined();
  });

  it("binds a newly created Gist before offering its conflict choices", async () => {
    const mock = chromeMock({ setupSeen: true, settings: DEFAULT_SETTINGS, localUpdatedAt: LOCAL_TIME }, []);
    vi.stubGlobal("chrome", mock.api);
    let finishCreate!: (value: RemoteSnapshot) => void;
    const created = new Promise<RemoteSnapshot>((resolve) => {
      finishCreate = resolve;
    });
    gistMock.create.mockReturnValue(created);
    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    const connecting = sendRequest(mock.messageListeners[0], { type: "SAVE_TOKEN", token: "new-token" });
    await flushImmediateTimers();
    expect(gistMock.create).toHaveBeenCalled();
    const original = gistMock.create.mock.calls[0][0] as Snapshot;
    await sendRequest(mock.messageListeners[0], { type: "SAVE_SETTINGS", settings: { ...DEFAULT_SETTINGS, openTarget: "current-tab" } });
    finishCreate(remote(original));
    const connected = await connecting;
    gistMock.read.mockResolvedValue(remote(original));
    const diffId = connected.state!.diff!.id;
    const result = await sendRequest(mock.messageListeners[0], { type: "USE_REMOTE", diffId });
    expect(result.ok).toBe(true);
  });
});
