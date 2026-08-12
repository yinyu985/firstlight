import { GistClient, GitHubError, normalizeGitHubToken, type RemoteSnapshot } from "../shared/gist";
import {
  DEFAULT_SETTINGS,
  type ClockPosition,
  type BookmarkItem,
  type SyncNote,
  type RecoveryPoint,
  type RecoveryReason,
  type Snapshot,
  type SyncStatus,
  type SyncedSettings,
  snapshotFrom,
  eastEightTimestamp,
  settingsFromSnapshot
} from "../shared/model";
import {
  isDynamicSpeedValid,
  normalizeDynamicEffect,
  normalizeDynamicParameters,
  normalizeDynamicSpeed
} from "../shared/dynamicEffects";
import type { AppState, ExtensionRequest, ExtensionResponse, StoredState } from "../shared/protocol";
import { SnapshotValidationError, snapshotHash, validateSnapshot } from "../shared/snapshot";
import { canAutoUpload, decideSyncWithRevision } from "../shared/sync-decision";

const STORAGE_KEY = "firstlight";
let memory: StoredState = {};
let bookmarks: BookmarkItem[] = [];
let initialized = false;
let initializing: Promise<void> | undefined;
let uploadTimer: ReturnType<typeof setTimeout> | undefined;
let restoring = false;
let operation = Promise.resolve();
let startupRemoteCheckPending = false;
let startupRemoteCheckRequested = false;
let openSetupOnLaunch = false;
const SEARCH_TEXT_OPTIONS: readonly ClockPosition[] = ["hidden", "left", "center", "right"];

const isSearchTextPosition = (value: unknown): value is ClockPosition => value === "hidden" || value === "left" || value === "center" || value === "right";

function queue<T>(task: () => Promise<T>): Promise<T> {
  const next = operation.then(task, task);
  operation = next.then(() => undefined, () => undefined);
  return next;
}

async function saveMemory(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: memory });
}

function sanitizeNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkItem {
  if (typeof node.url === "string") return { title: node.title, url: node.url };
  return { title: node.title, children: (node.children ?? []).map(sanitizeNode) };
}

async function readBookmarks(): Promise<BookmarkItem[]> {
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0]?.children?.[0];
  if (!bar) throw new Error("Unable to read the Chrome bookmarks bar");
  return (bar.children ?? []).map(sanitizeNode);
}

async function getBookmarkBarId(): Promise<string> {
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0]?.children?.[0];
  if (!bar) throw new Error("Unable to locate the Chrome bookmarks bar");
  return bar.id;
}

async function clearFolder(parentId: string): Promise<void> {
  const children = await chrome.bookmarks.getChildren(parentId);
  for (const child of children) {
    if (child.url) await chrome.bookmarks.remove(child.id);
    else await chrome.bookmarks.removeTree(child.id);
  }
}

async function createNodes(parentId: string, nodes: BookmarkItem[]): Promise<void> {
  for (const node of nodes) {
    if (node.url !== undefined) {
      await chrome.bookmarks.create({ parentId, title: node.title, url: node.url });
    } else {
      const folder = await chrome.bookmarks.create({ parentId, title: node.title });
      await createNodes(folder.id, node.children ?? []);
    }
  }
}

async function overwriteBookmarks(nodes: BookmarkItem[]): Promise<void> {
  const barId = await getBookmarkBarId();
  await clearFolder(barId);
  await createNodes(barId, nodes);
}

function currentSettings(): SyncedSettings {
  return memory.settings ?? DEFAULT_SETTINGS;
}

function touchLocalUpdatedAt(): string {
  const updatedAt = eastEightTimestamp();
  memory.localUpdatedAt = updatedAt;
  return updatedAt;
}

function localUpdatedAt(): string {
  if (!memory.localUpdatedAt) {
    memory.localUpdatedAt = eastEightTimestamp();
  }
  return memory.localUpdatedAt;
}

function currentSnapshot(): Snapshot {
  return snapshotFrom(bookmarks, currentSettings(), memory.notes ?? [], localUpdatedAt());
}

function normalizeNotes(raw: unknown): SyncNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): SyncNote | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const note = item as Record<string, unknown>;
      if (typeof note.id !== "string" || typeof note.name !== "string" || typeof note.content !== "string" || typeof note.createtime !== "string" || typeof note.updatetime !== "string") {
        return undefined;
      }
      if (!note.createtime.endsWith("+08:00") || !note.updatetime.endsWith("+08:00") || Number.isNaN(Date.parse(note.createtime)) || Number.isNaN(Date.parse(note.updatetime))) {
        return undefined;
      }
      return {
        id: note.id,
        name: note.name,
        content: note.content,
        createtime: note.createtime,
        updatetime: note.updatetime
      };
    })
    .filter((note): note is SyncNote => note !== undefined);
}

function appState(): AppState {
  return {
    target: "extension",
    bookmarks,
    notes: memory.notes,
    settings: currentSettings(),
    sync: memory.sync ?? { phase: "local-only", message: "Local only" },
    toast: memory.toast,
    diff: memory.pendingDiff,
    gistUrl: memory.gistUrl,
    token: memory.token,
    tokenConfigured: Boolean(memory.token),
    openSetupOnLaunch
  };
}

function broadcast(): void {
  chrome.runtime.sendMessage({ type: "STATE_CHANGED", state: appState() }).catch(() => undefined);
}

async function setStatus(status: SyncStatus): Promise<void> {
  memory.sync = status;
  if (status.phase === "error" || status.phase === "conflict") {
    memory.toast = { id: crypto.randomUUID(), message: status.message, expiresAt: Date.now() + 10_000 };
  }
  await saveMemory();
  broadcast();
}

async function publishToast(message: string): Promise<void> {
  memory.toast = { id: crypto.randomUUID(), message, expiresAt: Date.now() + 5_000 };
  await saveMemory();
  broadcast();
}

async function saveRecovery(snapshot: Snapshot, reason: RecoveryReason): Promise<RecoveryPoint> {
  const point: RecoveryPoint = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reason,
    snapshot
  };
  memory.recoveryPoints = [point, ...(memory.recoveryPoints ?? [])].slice(0, 3);
  await saveMemory();
  return point;
}

async function establishBaseline(snapshot: Snapshot, remote: RemoteSnapshot): Promise<void> {
  const [localHash, remoteHash] = await Promise.all([snapshotHash(snapshot), snapshotHash(remote.snapshot)]);
  memory.baseline = { localHash, remoteHash, remoteUpdatedAt: remote.updatedAt };
  memory.syncEnabled = true;
  memory.gistId = remote.gistId;
  memory.gistUrl = remote.htmlUrl;
  memory.pendingDiff = undefined;
  memory.sync = {
    phase: "synced",
    message: "Synced",
    gistId: remote.gistId,
    remoteUpdatedAt: remote.updatedAt
  };
  await saveMemory();
  broadcast();
}

async function restoreSnapshot(target: Snapshot, reason: RecoveryReason): Promise<void> {
  validateSnapshot(target);
  const before = currentSnapshot();
  await saveRecovery(before, reason);
  restoring = true;
  await setStatus({ phase: "restoring", message: "Restoring bookmarks…", gistId: memory.gistId });
  try {
    await overwriteBookmarks(target.bookmarks);
    memory.settings = settingsFromSnapshot(target);
    bookmarks = await readBookmarks();
    memory.notes = target.notes ?? [];
    const verified = snapshotFrom(bookmarks, memory.settings, memory.notes);
    if (await snapshotHash(verified) !== await snapshotHash(target)) {
      throw new Error("Restored bookmarks failed verification");
    }
    memory.localUpdatedAt = target.updatedAt;
    await saveMemory();
  } catch (error) {
    try {
      await overwriteBookmarks(before.bookmarks);
      memory.settings = settingsFromSnapshot(before);
      memory.notes = before.notes;
      bookmarks = await readBookmarks();
      const rollback = snapshotFrom(bookmarks, memory.settings, memory.notes, before.updatedAt);
      if (await snapshotHash(rollback) !== await snapshotHash(before)) throw new Error("Rollback verification failed");
      memory.localUpdatedAt = before.updatedAt;
      await setStatus({ phase: "error", message: `Restore failed and was rolled back: ${errorMessage(error)}`, gistId: memory.gistId });
    } catch (rollbackError) {
      await setStatus({ phase: "error", message: `Restore and rollback both failed: ${errorMessage(rollbackError)}`, gistId: memory.gistId });
    }
    throw error;
  } finally {
    restoring = false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isBadCredentials(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof GitHubError && error.status === 401) return true;
  return /bad credentials/i.test(error.message);
}

async function deactivateRemoteSync(message = "Remote auth failed. Check your GitHub token"): Promise<void> {
  memory.syncEnabled = false;
  memory.gistId = undefined;
  memory.gistUrl = undefined;
  memory.pendingDiff = undefined;
  memory.sync = { phase: "local-only", message };
  memory.toast = { id: crypto.randomUUID(), message, expiresAt: Date.now() + 10_000 };
  await saveMemory();
  broadcast();
}

async function connectedClient(): Promise<GistClient> {
  if (!memory.token) throw new Error("Enter a GitHub token first");
  return new GistClient(memory.token);
}

async function resolveGist(client: GistClient, create: boolean, beforeCreate?: () => Promise<void>): Promise<RemoteSnapshot | undefined> {
  if (memory.gistId) {
    try {
      return await client.read(memory.gistId);
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error;
      memory.gistId = undefined;
      memory.gistUrl = undefined;
      memory.baseline = undefined;
      await saveMemory();
    }
  }
  const found = await client.discover();
  const newest = found.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  if (newest) {
    memory.gistId = newest.gistId;
    await saveMemory();
    return client.read(newest.gistId);
  }
  if (!create) return undefined;
  await beforeCreate?.();
  return client.create(currentSnapshot());
}

async function checkRemoteOnStartup(createIfMissing = false): Promise<void> {
  if (!memory.token) return;
  await setStatus({ phase: "discovering", message: "Checking remote…", gistId: memory.gistId });
  try {
    const client = await connectedClient();
    const remote = await resolveGist(client, createIfMissing, async () => {
      await setStatus({ phase: "uploading", message: "Creating remote snapshot…" });
    });
    if (!remote) {
      await setStatus({ phase: "local-only", message: "Remote not configured" });
      return;
    }
    const local = currentSnapshot();
    const [localHash, remoteHash] = await Promise.all([snapshotHash(local), snapshotHash(remote.snapshot)]);
    if (localHash !== remoteHash) {
      if (memory.baseline && remoteHash === memory.baseline.remoteHash) {
        memory.pendingDiff = undefined;
        const uploaded = await client.update(remote.gistId, local);
        if (await snapshotHash(uploaded.snapshot) !== localHash) throw new Error("Remote verification failed after upload");
        await establishBaseline(local, uploaded);
        memory.sync = { ...memory.sync!, message: "Uploaded to remote" };
        await publishToast("Uploaded to remote");
        return;
      }
      memory.pendingDiff = { source: "remote", left: local, right: remote.snapshot };
      memory.gistUrl = remote.htmlUrl;
      await setStatus({ phase: "conflict", message: "Local and remote differ. Choose a snapshot.", gistId: remote.gistId, remoteUpdatedAt: remote.updatedAt });
    } else {
      await establishBaseline(local, remote);
    }
  } catch (error) {
    if (isBadCredentials(error)) {
      await deactivateRemoteSync("Invalid GitHub token");
      return;
    }
    throw error;
  }
}

function scheduleStartupRemoteCheck(): void {
  if (startupRemoteCheckRequested || startupRemoteCheckPending || !memory.syncEnabled) return;
  startupRemoteCheckRequested = true;
  startupRemoteCheckPending = true;
  void queue(() => checkRemoteOnStartup())
    .catch(async (error) => {
      startupRemoteCheckRequested = false;
      if (isBadCredentials(error)) await deactivateRemoteSync("Invalid GitHub token");
      else await setStatus({ phase: "error", message: errorMessage(error), gistId: memory.gistId });
    })
    .finally(() => {
      startupRemoteCheckPending = false;
    });
}

async function upload(force = false): Promise<void> {
  try {
    bookmarks = await readBookmarks();
    const local = currentSnapshot();
    const client = await connectedClient();
    await setStatus({ phase: "uploading", message: memory.gistId ? "Uploading…" : "Creating remote snapshot…", gistId: memory.gistId });
    let remote: RemoteSnapshot | undefined;
    remote = await resolveGist(client, true);
    if (!remote) return;

    if (memory.baseline && !force) {
      const [localHash, remoteHash] = await Promise.all([snapshotHash(local), snapshotHash(remote.snapshot)]);
      const decision = decideSyncWithRevision(
        localHash,
        remoteHash,
        memory.baseline.localHash,
        memory.baseline.remoteUpdatedAt,
        remote.updatedAt
      );
      if (decision === "conflict" || decision === "restore") {
        memory.pendingDiff = { source: "remote", left: local, right: remote.snapshot };
        memory.gistUrl = remote.htmlUrl;
        await setStatus({ phase: "conflict", message: "Remote changed. Choose a snapshot.", gistId: remote.gistId, remoteUpdatedAt: remote.updatedAt });
        return;
      }
      if (decision === "idle" || decision === "adopt") {
        await establishBaseline(local, remote);
        return;
      }
    } else if (!memory.baseline && memory.gistId && !force) {
      const [localHash, remoteHash] = await Promise.all([snapshotHash(local), snapshotHash(remote.snapshot)]);
      if (localHash !== remoteHash) {
        memory.pendingDiff = { source: "remote", left: local, right: remote.snapshot };
        memory.gistUrl = remote.htmlUrl;
        await setStatus({ phase: "conflict", message: "Choose the local or remote snapshot", gistId: remote.gistId, remoteUpdatedAt: remote.updatedAt });
        return;
      }
    }

    remote = await client.update(remote.gistId, local);
    const remoteHash = await snapshotHash(remote.snapshot);
    const localHash = await snapshotHash(local);
    if (remoteHash !== localHash) throw new Error("Remote verification failed after upload");
    await establishBaseline(local, remote);
    memory.sync = { ...memory.sync!, message: "Uploaded to remote" };
    await publishToast("Uploaded to remote");
  } catch (error) {
    if (isBadCredentials(error)) {
      await deactivateRemoteSync("Invalid GitHub token");
      return;
    }
    if (force && error instanceof SnapshotValidationError && memory.gistId) {
      const client = await connectedClient();
      const local = currentSnapshot();
      const remote = await client.update(memory.gistId, local);
      const [remoteHash, localHash] = await Promise.all([snapshotHash(remote.snapshot), snapshotHash(local)]);
      if (remoteHash !== localHash) throw new Error("Remote verification failed after replacing the invalid snapshot");
      await establishBaseline(local, remote);
      memory.sync = { ...memory.sync!, message: "Uploaded current snapshot" };
      await publishToast("Uploaded current snapshot");
      return;
    }
    throw error;
  }
}

async function importFromChrome(): Promise<void> {
  bookmarks = await readBookmarks();
  memory.localUpdatedAt = touchLocalUpdatedAt();
  await saveMemory();
  scheduleUpload();
  await publishToast("Chrome bookmarks imported");
}

function scheduleUpload(): void {
  if (!canAutoUpload(memory.syncEnabled, memory.token, memory.gistId, restoring)) return;
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    queue(() => upload(false)).catch(async (error) => {
      if (isBadCredentials(error)) await deactivateRemoteSync("Invalid GitHub token");
      else await setStatus({ phase: "error", message: errorMessage(error), gistId: memory.gistId });
    });
  }, 10_000);
}

async function compareRemote(): Promise<void> {
  try {
    const client = await connectedClient();
    const remote = await resolveGist(client, false);
    if (!remote) throw new Error("No remote snapshot found");
    bookmarks = await readBookmarks();
    const local = currentSnapshot();
    if (await snapshotHash(local) === await snapshotHash(remote.snapshot)) {
      memory.pendingDiff = undefined;
      await establishBaseline(local, remote);
      await publishToast("Local and remote match");
      return;
    }
    memory.pendingDiff = { source: "remote", left: local, right: remote.snapshot };
    memory.gistUrl = remote.htmlUrl;
    await saveMemory();
    broadcast();
  } catch (error) {
    if (isBadCredentials(error)) {
      await deactivateRemoteSync("Invalid GitHub token");
      return;
    }
    throw error;
  }
}

async function useRemote(): Promise<void> {
  const diff = memory.pendingDiff;
  if (!diff) throw new Error("No pending comparison");
  await restoreSnapshot(diff.right, "manual-restore");
  bookmarks = await readBookmarks();
  const client = await connectedClient();
  if (!memory.gistId) throw new Error("Gist connection is missing");
  await establishBaseline(currentSnapshot(), await client.read(memory.gistId));
  memory.sync = { ...memory.sync!, message: "Restored remote snapshot" };
  await publishToast("Restored remote snapshot");
}

async function initialize(): Promise<void> {
  if (initialized) return;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  memory = (stored[STORAGE_KEY] as StoredState | undefined) ?? {};
  memory.settings ??= DEFAULT_SETTINGS;
  if (memory.settings.background.type === "dynamic") {
    const normalizedEffect = normalizeDynamicEffect(memory.settings.background.effect);
    const normalizedSpeed = normalizeDynamicSpeed(normalizedEffect, memory.settings.background.speed);
    const normalizedParameters = normalizeDynamicParameters(normalizedEffect, memory.settings.background.parameters);
    const migrated =
      !isDynamicSpeedValid(normalizedEffect, memory.settings.background.speed) ||
      !Number.isFinite(memory.settings.background.angle) ||
      normalizedEffect !== memory.settings.background.effect ||
      normalizedSpeed !== memory.settings.background.speed ||
      JSON.stringify(memory.settings.background.parameters ?? {}) !== JSON.stringify(normalizedParameters);

    if (migrated) {
      memory.settings = {
        ...memory.settings,
        background: {
          ...memory.settings.background,
          effect: normalizedEffect,
          angle: Number.isFinite(memory.settings.background.angle) ? memory.settings.background.angle : 145,
          speed: normalizedSpeed,
          parameters: normalizedParameters
        }
      };
      await saveMemory();
    }
  }
  if (memory.settings.layout.bookmarkAlignment !== "left" &&
    memory.settings.layout.bookmarkAlignment !== "center" &&
    memory.settings.layout.bookmarkAlignment !== "right") {
    memory.settings = {
      ...memory.settings,
      layout: { ...memory.settings.layout, bookmarkAlignment: "center" }
    };
    await saveMemory();
  }
  if (memory.settings.features.hoverStyle !== "underline" &&
    memory.settings.features.hoverStyle !== "box" &&
    memory.settings.features.hoverStyle !== "block") {
    memory.settings = {
      ...memory.settings,
      features: { ...memory.settings.features, hoverStyle: "underline" }
    };
    await saveMemory();
  }
  if (typeof memory.settings.features.hoverColor !== "string" || !/^#[0-9a-f]{6}$/i.test(memory.settings.features.hoverColor)) {
    memory.settings = {
      ...memory.settings,
      features: { ...memory.settings.features, hoverColor: "#59d5b8" }
    };
    await saveMemory();
  }
  if (memory.settings.features.themeMode !== "dark" && memory.settings.features.themeMode !== "light") {
    memory.settings = {
      ...memory.settings,
      features: { ...memory.settings.features, themeMode: "dark" }
    };
    await saveMemory();
  }
  const storedSearchText: unknown = memory.settings.features.searchText;
  const normalizedSearchText = storedSearchText === true
    ? SEARCH_TEXT_OPTIONS[1]
    : storedSearchText === false
      ? SEARCH_TEXT_OPTIONS[0]
      : isSearchTextPosition(storedSearchText)
        ? storedSearchText
        : undefined;
  if (typeof memory.settings.features.searchIcon !== "boolean" ||
    !isSearchTextPosition(normalizedSearchText) ||
    typeof memory.settings.features.bookmarkDetails !== "boolean" ||
    typeof memory.settings.features.clockSeconds !== "boolean") {
    memory.settings = {
      ...memory.settings,
      features: {
        ...memory.settings.features,
        searchIcon: true,
        searchText: normalizedSearchText ?? SEARCH_TEXT_OPTIONS[1],
        bookmarkDetails: true,
        clockSeconds: false
      }
    };
    await saveMemory();
  }
  openSetupOnLaunch = !memory.setupSeen;
  if (!memory.localUpdatedAt) {
    memory.localUpdatedAt = eastEightTimestamp();
    await saveMemory();
  }
  memory.notes = normalizeNotes(memory.notes);
  if (memory.toast && (!Number.isFinite(memory.toast.expiresAt) || memory.toast.expiresAt <= Date.now())) {
    memory.toast = undefined;
    await saveMemory();
  }
  const recoveryPoints = (memory.recoveryPoints ?? []).filter((point) => {
    try { validateSnapshot(point.snapshot); return true; }
    catch { return false; }
  });
  let invalidLocalSnapshot = recoveryPoints.length !== (memory.recoveryPoints ?? []).length;
  memory.recoveryPoints = recoveryPoints;
  if (memory.pendingDiff) {
    try {
      validateSnapshot(memory.pendingDiff.left);
      validateSnapshot(memory.pendingDiff.right);
    } catch {
      memory.pendingDiff = undefined;
      invalidLocalSnapshot = true;
    }
  }
  if (invalidLocalSnapshot) {
    await saveMemory();
  }
  if (!memory.token && memory.sync?.phase !== "local-only") {
    memory.sync = { phase: "local-only", message: "Local only" };
    await saveMemory();
  }
  if (memory.token && (!memory.syncEnabled || !memory.gistId) && memory.sync?.phase !== "local-only") {
    memory.sync = { phase: "local-only", message: "Remote not configured" };
    await saveMemory();
  }
  if (memory.token && memory.gistId && memory.sync && (
    memory.sync.phase === "uploading" || memory.sync.phase === "restoring" || memory.sync.phase === "discovering"
  )) {
    memory.sync = { phase: "discovering", message: "Checking remote…", gistId: memory.gistId };
    await saveMemory();
  }
  bookmarks = await readBookmarks();
  initialized = true;
  broadcast();
}

function ensureInitialized(): Promise<void> {
  initializing ??= initialize();
  return initializing;
}

async function handle(request: ExtensionRequest): Promise<AppState> {
  await ensureInitialized();
  switch (request.type) {
    case "GET_STATE": break;
    case "SAVE_SETTINGS":
      memory.settings = request.settings;
      memory.localUpdatedAt = touchLocalUpdatedAt();
      await saveMemory();
      broadcast();
      scheduleUpload();
      break;
    case "SAVE_NOTES":
      memory.notes = request.notes.map((note) => ({
        ...note,
        createtime: note.createtime,
        updatetime: note.updatetime
      }));
      memory.localUpdatedAt = touchLocalUpdatedAt();
      await saveMemory();
      broadcast();
      scheduleUpload();
      break;
    case "SAVE_TOKEN":
      memory.token = normalizeGitHubToken(request.token) || undefined;
      memory.gistId = undefined;
      memory.gistUrl = undefined;
      memory.baseline = undefined;
      memory.syncEnabled = false;
      memory.pendingDiff = undefined;
      await saveMemory();
      if (memory.token) await checkRemoteOnStartup(true);
      else await setStatus({ phase: "local-only", message: "Local only" });
      break;
    case "UPLOAD_NOW": await upload(true); break;
    case "IMPORT_BOOKMARKS": await importFromChrome(); break;
    case "COMPARE_REMOTE": await compareRemote(); break;
    case "USE_LOCAL": await upload(true); break;
    case "USE_REMOTE": await useRemote(); break;
    case "CLEAR_DIFF": memory.pendingDiff = undefined; await saveMemory(); broadcast(); break;
    case "OPEN_BOOKMARK_MANAGER": await chrome.tabs.create({ url: "chrome://bookmarks/" }); break;
  }
  return appState();
}

chrome.runtime.onMessage.addListener((request: ExtensionRequest, _sender, sendResponse: (response: ExtensionResponse) => void) => {
  if (request.type === "GET_STATE") {
    void ensureInitialized()
      .then(async () => {
        const initialState = appState();
        sendResponse({ ok: true, state: initialState });
        if (openSetupOnLaunch) {
          openSetupOnLaunch = false;
          memory.setupSeen = true;
          await saveMemory();
          broadcast();
        }
        setTimeout(scheduleStartupRemoteCheck, 0);
      })
      .catch((error) => sendResponse({ ok: false, state: appState(), error: errorMessage(error) }));
    return true;
  }
  queue(() => handle(request))
    .then((state) => sendResponse({ ok: true, state }))
    .catch(async (error) => {
      const message = errorMessage(error);
      await setStatus({ phase: "error", message, gistId: memory.gistId });
      sendResponse({ ok: false, state: appState(), error: message });
    });
  return true;
});

const onBookmarksChanged = () => {
  if (restoring) return;
  queue(async () => {
    await ensureInitialized();
    bookmarks = await readBookmarks();
    memory.localUpdatedAt = touchLocalUpdatedAt();
    await saveMemory();
    broadcast();
    scheduleUpload();
  }).catch(() => undefined);
};

chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
chrome.bookmarks.onMoved.addListener(onBookmarksChanged);
chrome.bookmarks.onChildrenReordered.addListener(onBookmarksChanged);
chrome.runtime.onInstalled.addListener(() => { void ensureInitialized(); });
chrome.runtime.onStartup.addListener(() => {
  void ensureInitialized().then(scheduleStartupRemoteCheck);
});
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({});
});
void ensureInitialized();
