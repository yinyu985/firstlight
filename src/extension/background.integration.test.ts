import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, createDiffId, snapshotFrom, type BookmarkItem, type Snapshot, type SyncedSettings } from "../shared/model";
import type { ExtensionRequest, ExtensionResponse, StoredState } from "../shared/protocol";
import { snapshotHash } from "../shared/snapshot";
import type { RemoteSnapshot } from "../shared/gist";

const gistMock = vi.hoisted(() => ({
  discover: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn()
}));

vi.mock("../shared/gist", async () => {
  const actual = await vi.importActual<typeof import("../shared/gist")>("../shared/gist");
  class MockGistClient {
    discover = gistMock.discover;
    read = gistMock.read;
    create = gistMock.create;
    update = gistMock.update;
  }
  return { ...actual, GistClient: MockGistClient };
});

type MessageListener = (
  request: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionResponse) => void
) => boolean | undefined;

const LOCAL_TIME = "2026-08-20T17:00:00.000+08:00";
const REMOTE_TIME = "2026-08-20T09:01:00.000Z";

function remote(snapshot: Snapshot, updatedAt = REMOTE_TIME): RemoteSnapshot {
  return { gistId: "gist-1", htmlUrl: "https://gist.github.com/gist-1", updatedAt, snapshot };
}

function chromeMock(initialState: StoredState, initialBookmarks: BookmarkItem[] = []) {
  const messageListeners: MessageListener[] = [];
  const startupListeners: Array<() => void> = [];
  const alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void> = [];
  let storedState = structuredClone(initialState);
  let nextBookmarkId = 10;
  let createFailures = 0;
  let failEveryCreate = false;

  const toTreeNodes = (items: BookmarkItem[]): chrome.bookmarks.BookmarkTreeNode[] => items.map((item) => {
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
  const bookmarkItems = (nodes = bar.children ?? []): BookmarkItem[] => nodes.map((node) => node.url !== undefined
    ? { title: node.title, url: node.url }
    : { title: node.title, children: bookmarkItems(node.children ?? []) });

  const storageSet = vi.fn(async (value: Record<string, unknown>) => {
    if (value.firstlight !== undefined) storedState = structuredClone(value.firstlight as StoredState);
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
        get: vi.fn(async () => ({ firstlight: structuredClone(storedState) })),
        set: storageSet
      }
    },
    bookmarks: {
      getTree: vi.fn(async () => [{ id: "0", title: "", children: [structuredClone(bar)] }]),
      getChildren: vi.fn(async (parentId: string) => structuredClone((parentId === "1" ? bar : findNode(parentId))?.children ?? [])),
      remove: vi.fn(async (id: string) => { removeNode(id); }),
      removeTree: vi.fn(async (id: string) => { removeNode(id); }),
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
    getStored: () => structuredClone(storedState),
    messageListeners,
    setCreateFailures: (count: number) => { createFailures = count; },
    setFailEveryCreate: (value: boolean) => { failEveryCreate = value; },
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
  gistMock.create.mockReset();
  gistMock.update.mockReset().mockImplementation(async (gistId: string, snapshot: Snapshot) => ({
    ...remote(snapshot, "2026-08-20T09:02:00.000Z"),
    gistId
  }));
});

afterEach(async () => {
  vi.clearAllTimers();
  await flushAsync();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

describe("extension background integration", () => {
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
    state.settings = Object.fromEntries(
      Object.entries(baseline.config).sort(([left], [right]) => left.localeCompare(right))
    ) as unknown as SyncedSettings;
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
    expect(response.state?.toast?.message).toBe("Some stored settings were invalid and were repaired");
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
    expect(mock.getStored().recoveryPoints).toEqual([
      expect.objectContaining({ snapshot: expect.objectContaining({ bookmarks: local.bookmarks }) })
    ]);
    expect(response.state?.sync.phase).toBe("synced");
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

  it("turns a pending automatic upload into Diff when the remote changed", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const changedRemote = snapshotFrom([{ title: "Remote", url: "https://remote.example" }], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    const mock = chromeMock(state);
    gistMock.read.mockResolvedValue(remote(changedRemote, "2026-08-20T09:05:00.000Z"));
    vi.stubGlobal("chrome", mock.api as unknown as typeof chrome);

    await import("./background");
    await sendRequest(mock.messageListeners[0], { type: "GET_STATE" });
    await flushImmediateTimers();
    await vi.waitFor(() => expect(mock.getStored().sync?.phase).toBe("conflict"));

    expect(gistMock.update).not.toHaveBeenCalled();
    expect(mock.getStored().pendingUpload).toBeUndefined();
    expect(mock.getStored().pendingDiff).toMatchObject({ right: { bookmarks: changedRemote.bookmarks } });
  });

  it("keeps a failed automatic upload pending with bounded backoff", async () => {
    const baseline = snapshotFrom([], DEFAULT_SETTINGS, [], LOCAL_TIME);
    const state = await connectedState(baseline);
    state.pendingUpload = { dueAt: Date.now() - 1, attempts: 0 };
    const mock = chromeMock(state, [{ title: "Local", url: "https://local.example" }]);
    gistMock.read.mockRejectedValue(new Error("temporary network failure"));
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
