import { GistClient, GitHubError, isRetryableGitHubError, normalizeGitHubToken, type RemoteSnapshot } from "../shared/gist";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  type BookmarkItem,
  type DiffPayload,
  type RecoveryPoint,
  type RecoveryReason,
  type Snapshot,
  type SyncStatus,
  type SyncedSettings,
  createDiffId,
  snapshotFrom,
  eastEightTimestamp,
  settingsFromSnapshot
} from "../shared/model";
import type { AppState, ExtensionRequest, ExtensionResponse, StoredState } from "../shared/protocol";
import { parseExtensionRequest } from "../shared/requestValidation";
import { inspectSettings, settingsRepairMessage, sha256, snapshotHash, validateNotes, validateSnapshot } from "../shared/snapshot";
import { canAutoUpload, decideSyncWithRevision } from "../shared/sync-decision";
import { StateRepository, StorageCommitError } from "./stateRepository";
import { statePatch } from "../shared/statePatch";
import { NotesDecryptionError } from "../shared/notesEnvelope";

const repository = new StateRepository(chrome.storage.local, chrome.storage.session);
const UPLOAD_ALARM = "firstlight-pending-upload";
const UPLOAD_DEBOUNCE_MS = 10_000;
const UPLOAD_RETRY_MAX_MS = 5 * 60_000;
let memory: StoredState = {};
let bookmarks: BookmarkItem[] = [];
let initialized = false;
let initializing: Promise<void> | undefined;
let uploadTimer: ReturnType<typeof setTimeout> | undefined;
let restoring = false;
let operation = Promise.resolve();
let localOperation = Promise.resolve();
const STARTUP_SESSION_KEY = "firstlight.startup-checked";
let startupRemoteCheckPending = false;
let startupRemoteCheckRequested = false;
let openSetupOnLaunch = false;
let pendingUploadRunning = false;

class HandledOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandledOperationError";
  }
}

function queue<T>(task: () => Promise<T>): Promise<T> {
  const next = operation.then(task, task);
  operation = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function queueLocal<T>(task: () => Promise<T>): Promise<T> {
  const next = localOperation.then(task, task);
  localOperation = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function commitMemory(patch: Partial<StoredState>): Promise<void> {
  await repository.save({ ...memory, ...patch });
  Object.assign(memory, patch);
}

async function markStartupChecked(): Promise<void> {
  await chrome.storage.session.set({ [STARTUP_SESSION_KEY]: true });
  startupRemoteCheckRequested = true;
}

function cancelScheduledUpload(clearPending = false): void {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = undefined;
  }
  void chrome.alarms.clear(UPLOAD_ALARM).catch(() => undefined);
  if (clearPending) memory.pendingUpload = undefined;
}

function remoteDiff(left: Snapshot, remote: Pick<RemoteSnapshot, "gistId" | "updatedAt" | "snapshot">, leftHash: string, rightHash: string): DiffPayload {
  return {
    id: createDiffId("remote", leftHash, rightHash, remote.updatedAt),
    source: "remote",
    leftHash,
    rightHash,
    gistId: remote.gistId,
    remoteUpdatedAt: remote.updatedAt,
    left,
    right: remote.snapshot
  };
}

function requirePendingDiff(diffId: string): DiffPayload {
  const diff = memory.pendingDiff;
  if (!diff || diff.id !== diffId) {
    throw new HandledOperationError("The comparison changed. Review the latest diff before choosing a snapshot.");
  }
  return diff;
}

async function saveMemory(): Promise<void> {
  await repository.save(memory);
}

function sanitizeNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkItem {
  if (typeof node.url === "string") return { title: node.title, url: node.url };
  return { title: node.title, children: (node.children ?? []).map(sanitizeNode) };
}

async function readBookmarks(): Promise<BookmarkItem[]> {
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0]?.children?.[0];
  if (!bar) throw new Error("Unable to read the Chrome bookmarks bar");
  const next = (bar.children ?? []).map(sanitizeNode);
  return JSON.stringify(next) === JSON.stringify(bookmarks) ? bookmarks : next;
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

async function refreshPendingDiffLeft(local = currentSnapshot()): Promise<void> {
  const diff = memory.pendingDiff;
  if (!diff) return;
  const leftHash = await snapshotHash(local);
  if (leftHash === diff.leftHash) return;
  memory.pendingDiff = remoteDiff(
    local,
    {
      gistId: diff.gistId,
      updatedAt: diff.remoteUpdatedAt,
      snapshot: diff.right
    },
    leftHash,
    diff.rightHash
  );
  memory.sync = {
    phase: "conflict",
    message: "Local data changed. Review the updated comparison.",
    gistId: diff.gistId,
    remoteUpdatedAt: diff.remoteUpdatedAt
  };
}

function appState(): AppState {
  return {
    target: "extension",
    bookmarks,
    notes: memory.notes,
    settings: currentSettings(),
    sync: memory.sync ?? { phase: "local-only", message: "Local only" },
    toast: memory.toast,
    // GET_STATE can arrive while the deferred snapshots are still being checked.
    diff: pendingDiffReady ? memory.pendingDiff : undefined,
    gistUrl: memory.gistUrl,
    token: memory.token,
    rememberToken: memory.rememberToken,
    tokenConfigured: Boolean(memory.token),
    openSetupOnLaunch
  };
}

let lastBroadcast: AppState | undefined;
function broadcast(): void {
  const next = appState();
  const patch = statePatch(lastBroadcast, next);
  lastBroadcast = next;
  if (Object.keys(patch).length) chrome.runtime.sendMessage({ type: "STATE_CHANGED", patch }).catch(() => undefined);
}

async function setStatus(status: SyncStatus): Promise<void> {
  memory.sync = status;
  if (status.phase === "error" || status.phase === "conflict") {
    memory.toast = { id: crypto.randomUUID(), message: status.message, expiresAt: Date.now() + 10_000 };
  }
  await saveMemory();
  broadcast();
}

async function setStatusBestEffort(status: SyncStatus): Promise<void> {
  try {
    await setStatus(status);
  } catch {
    memory.sync = status;
    if (status.phase === "error" || status.phase === "conflict") {
      memory.toast = { id: crypto.randomUUID(), message: status.message, expiresAt: Date.now() + 10_000 };
    }
    broadcast();
  }
}

async function publishToast(message: string, duration = 5_000): Promise<void> {
  memory.toast = { id: crypto.randomUUID(), message, expiresAt: Date.now() + duration };
  try {
    await saveMemory();
  } catch (error) {
    memory.toast = { id: crypto.randomUUID(), message: `${message}. Unable to save the notification: ${errorMessage(error)}`, expiresAt: Date.now() + 10_000 };
  }
  broadcast();
}

async function publishRemoteResult(remote: RemoteSnapshot, success?: string): Promise<void> {
  const repair = settingsRepairMessage(remote.settingsRepair ?? "none", remote.settingsRepairFields);
  if (repair) await publishToast(repair, 10_000);
  else if (success) await publishToast(success);
}

async function establishBaseline(snapshot: Snapshot, remote: RemoteSnapshot): Promise<void> {
  return queueLocal(() => commitBaseline(snapshot, remote));
}

async function commitBaseline(snapshot: Snapshot, remote: RemoteSnapshot, completeRestore = false): Promise<void> {
  const [localHash, remoteHash] = await Promise.all([snapshotHash(snapshot), snapshotHash(remote.snapshot)]);
  if (localHash !== remoteHash) {
    throw new Error("Cannot establish a sync baseline for different local and remote snapshots");
  }
  const changedSinceUpload = (await snapshotHash(currentSnapshot())) !== localHash;
  await commitMemory({
    ...(completeRestore ? { restoreJournal: undefined } : {}),
    bookmarkBarHash: await sha256(JSON.stringify(bookmarks)),
    baseline: { localHash, remoteHash, remoteUpdatedAt: remote.updatedAt },
    syncEnabled: true,
    gistId: remote.gistId,
    gistUrl: remote.htmlUrl,
    pendingDiff: undefined,
    pendingUpload: changedSinceUpload ? (memory.pendingUpload ?? { dueAt: Date.now() + UPLOAD_DEBOUNCE_MS, attempts: 0 }) : undefined,
    sync: {
      phase: changedSinceUpload ? "local-only" : "synced",
      message: changedSinceUpload ? "New local changes are waiting to upload" : "Synced",
      gistId: remote.gistId,
      remoteUpdatedAt: remote.updatedAt
    }
  });
  cancelScheduledUpload();
  armPendingUpload();
  broadcast();
}

async function overwriteAndVerifySnapshot(target: Snapshot): Promise<void> {
  await overwriteBookmarks(target.bookmarks);
  memory.settings = settingsFromSnapshot(target);
  memory.notes = target.notes;
  bookmarks = await readBookmarks();
  const verified = snapshotFrom(bookmarks, memory.settings, memory.notes, target.updatedAt);
  if ((await snapshotHash(verified)) !== (await snapshotHash(target))) {
    throw new Error("Restored bookmarks failed verification");
  }
  memory.localUpdatedAt = target.updatedAt;
}

async function prepareRestore(before: Snapshot, target: Snapshot, reason: RecoveryReason): Promise<void> {
  memory.recoveryPoints ??= await repository.loadRecoveryPoints();
  const point: RecoveryPoint = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reason,
    snapshot: before
  };
  memory.recoveryPoints = [point, ...(memory.recoveryPoints ?? [])].slice(0, 3);
  memory.restoreJournal = {
    recoveryPointId: point.id,
    targetHash: await snapshotHash(target),
    startedAt: point.createdAt
  };
  cancelScheduledUpload(true);
  memory.sync = { phase: "restoring", message: "Restoring bookmarks…", gistId: memory.gistId };
  await saveMemory();
  broadcast();
}

async function restoreSnapshot(target: Snapshot, reason: RecoveryReason, remote: RemoteSnapshot): Promise<void> {
  validateSnapshot(target);
  cancelScheduledUpload(true);
  restoring = true;
  let before: Snapshot | undefined;
  let mutationStarted = false;
  try {
    bookmarks = await readBookmarks();
    before = currentSnapshot();
    await prepareRestore(before, target, reason);
    mutationStarted = true;
    await overwriteAndVerifySnapshot(target);
    await commitBaseline(currentSnapshot(), remote, true);
  } catch (error) {
    const restoreError = errorMessage(error);
    if (!mutationStarted || !before) {
      const message = `Restore did not start: ${restoreError}`;
      await setStatusBestEffort({ phase: "error", message, gistId: memory.gistId });
      throw new HandledOperationError(message);
    }

    let rollbackError: unknown;
    try {
      await overwriteAndVerifySnapshot(before);
      await commitMemory({ restoreJournal: undefined });
    } catch (errorDuringRollback) {
      rollbackError = errorDuringRollback;
    }

    if (rollbackError !== undefined) {
      cancelScheduledUpload(true);
      memory.syncEnabled = false;
      memory.baseline = undefined;
      memory.pendingDiff = undefined;
      const message = `Restore failed: ${restoreError}. Rollback also failed: ${errorMessage(rollbackError)}`;
      await setStatusBestEffort({ phase: "error", message, gistId: memory.gistId });
      throw new HandledOperationError(message);
    }

    const message = `Restore failed and was rolled back: ${restoreError}`;
    await setStatusBestEffort({ phase: "error", message, gistId: memory.gistId });
    throw new HandledOperationError(message);
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
  cancelScheduledUpload(true);
  memory.syncEnabled = false;
  memory.gistId = undefined;
  memory.gistUrl = undefined;
  memory.pendingDiff = undefined;
  memory.sync = { phase: "local-only", message };
  memory.toast = { id: crypto.randomUUID(), message, expiresAt: Date.now() + 10_000 };
  await saveMemory();
  broadcast();
}

function assertRestoreComplete(): void {
  if (memory.restoreJournal) {
    throw new HandledOperationError("An interrupted restore must be rolled back before remote sync can continue.");
  }
}

async function connectedClient(): Promise<GistClient> {
  if (memory.tokenMigration) throw new Error("Token migration is incomplete. Save the replacement token again to resume.");
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
  return client.create(validateSnapshot(currentSnapshot()));
}

async function saveToken(input: string, rememberToken: boolean): Promise<void> {
  assertRestoreComplete();
  const token = normalizeGitHubToken(input) || undefined;
  const pending = memory.tokenMigration;
  if (pending && (!token || (pending.token && pending.token !== token))) {
    throw new HandledOperationError("Token migration is incomplete. Save the same replacement token to resume before changing connections.");
  }
  if (!pending && token === memory.token && memory.gistId && (memory.syncEnabled || memory.pendingDiff)) {
    await queueLocal(() => commitMemory({ rememberToken }));
    return;
  }
  try {
    let remote: RemoteSnapshot | undefined;
    if (token) {
      const client = new GistClient(token);
      if (pending) {
        // Refresh a session credential that was lost at browser shutdown before retrying.
        await queueLocal(() => commitMemory({ tokenMigration: { ...pending, token }, syncEnabled: false, pendingUpload: undefined }));
        remote = await client.rekey(pending.gistId, memory.token);
      } else {
        const found = await client.discover();
        const newest = found.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        if (newest) {
          try {
            remote = await client.read(newest.gistId);
          } catch (error) {
            if (!(error instanceof NotesDecryptionError) || !memory.token) throw error;
            remote = await client.rekey(newest.gistId, memory.token, async () => {
              cancelScheduledUpload(true);
              await queueLocal(() =>
                commitMemory({
                  tokenMigration: { id: crypto.randomUUID(), gistId: newest.gistId, token, rememberToken },
                  syncEnabled: false,
                  pendingUpload: undefined
                })
              );
            });
          }
        } else remote = await client.create(validateSnapshot(currentSnapshot()));
      }
    }
    cancelScheduledUpload(true);
    await queueLocal(() =>
      commitMemory({
        token,
        rememberToken,
        tokenMigration: undefined,
        gistId: remote?.gistId,
        gistUrl: remote?.htmlUrl,
        baseline: undefined,
        syncEnabled: false,
        pendingDiff: undefined,
        pendingUpload: undefined
      })
    );
    startupRemoteCheckRequested = false;
    await chrome.storage.session.set({ [STARTUP_SESSION_KEY]: false });
    if (remote) {
      await checkRemoteOnStartup(false, remote);
      await markStartupChecked();
    } else await setStatus({ phase: "local-only", message: "Local only" });
  } catch (error) {
    const message = `${errorMessage(error)}${memory.tokenMigration ? " Token migration is incomplete; save the replacement token again to resume." : ""}`;
    await setStatusBestEffort({ phase: "error", message, gistId: memory.gistId });
    // A bad *replacement* credential must not deactivate or erase the old connection.
    throw new HandledOperationError(message);
  }
}

async function checkRemoteOnStartup(createIfMissing = false, suppliedRemote?: RemoteSnapshot): Promise<void> {
  if (memory.restoreJournal) return;
  if (!memory.token) return;
  await setStatus({ phase: "discovering", message: "Checking remote…", gistId: memory.gistId });
  try {
    const client = await connectedClient();
    const remote =
      suppliedRemote ??
      (await resolveGist(client, createIfMissing, async () => {
        await setStatus({ phase: "uploading", message: "Creating remote snapshot…" });
      }));
    if (!remote) {
      await setStatus({ phase: "local-only", message: "Remote not configured" });
      return;
    }
    await queueLocal(async () => {
      const local = validateSnapshot(currentSnapshot());
      const [localHash, remoteHash] = await Promise.all([snapshotHash(local), snapshotHash(remote.snapshot)]);
      if (localHash !== remoteHash) {
        cancelScheduledUpload(true);
        memory.pendingDiff = remoteDiff(local, remote, localHash, remoteHash);
        memory.gistId = remote.gistId;
        memory.gistUrl = remote.htmlUrl;
        await setStatus({
          phase: "conflict",
          message: "Local and remote differ. Choose a snapshot.",
          gistId: remote.gistId,
          remoteUpdatedAt: remote.updatedAt
        });
      } else {
        await commitBaseline(local, remote);
      }
      await publishRemoteResult(remote);
    });
  } catch (error) {
    if (isBadCredentials(error)) {
      await deactivateRemoteSync("Invalid GitHub token");
      return;
    }
    throw error;
  }
}

function scheduleStartupRemoteCheck(): void {
  if (startupRemoteCheckRequested || startupRemoteCheckPending || memory.pendingUpload || !memory.syncEnabled) return;
  startupRemoteCheckRequested = true;
  startupRemoteCheckPending = true;
  void queue(async () => {
    await ensurePendingDiffReady();
    await checkRemoteOnStartup();
    await markStartupChecked();
  })
    .catch(async (error) => {
      startupRemoteCheckRequested = false;
      try {
        if (isBadCredentials(error)) await deactivateRemoteSync("Invalid GitHub token");
        else await setStatusBestEffort({ phase: "error", message: errorMessage(error), gistId: memory.gistId });
      } catch (statusError) {
        await setStatusBestEffort({ phase: "error", message: errorMessage(statusError), gistId: memory.gistId });
      }
    })
    .finally(() => {
      startupRemoteCheckPending = false;
    });
}

async function upload(force = false, reviewed?: DiffPayload): Promise<void> {
  assertRestoreComplete();
  bookmarks = await readBookmarks();
  let local = validateSnapshot(currentSnapshot());
  try {
    const client = await connectedClient();
    await setStatus({ phase: "uploading", message: memory.gistId ? "Uploading…" : "Creating remote snapshot…", gistId: memory.gistId });
    let remote: RemoteSnapshot | undefined;
    remote = await resolveGist(client, true);
    if (!remote) return;
    const deferred = await queueLocal(async () => {
      bookmarks = await readBookmarks();
      const latest = validateSnapshot(currentSnapshot());
      if ((await snapshotHash(latest)) === (await snapshotHash(local))) return false;
      if (!force) {
        await setStatus({ phase: "local-only", message: "Waiting for local edits to finish", gistId: memory.gistId });
        return true;
      }
      local = latest;
      return false;
    });
    if (deferred) return;

    if (reviewed) {
      const [localHash, remoteHash] = await Promise.all([snapshotHash(local), snapshotHash(remote.snapshot)]);
      if (remote.gistId !== reviewed.gistId || localHash !== reviewed.leftHash || remoteHash !== reviewed.rightHash) {
        cancelScheduledUpload(true);
        memory.pendingDiff = remoteDiff(local, remote, localHash, remoteHash);
        memory.gistUrl = remote.htmlUrl;
        await setStatusBestEffort({
          phase: "conflict",
          message: "Local or remote data changed. Review the updated comparison.",
          gistId: remote.gistId,
          remoteUpdatedAt: remote.updatedAt
        });
        throw new HandledOperationError("The comparison is out of date. Review the latest diff before overwriting remote data.");
      }
    }

    if (memory.baseline && !force) {
      const [localHash, remoteHash] = await Promise.all([snapshotHash(local), snapshotHash(remote.snapshot)]);
      const decision = decideSyncWithRevision(localHash, remoteHash, memory.baseline.localHash, memory.baseline.remoteUpdatedAt, remote.updatedAt);
      if (decision === "conflict" || decision === "restore") {
        cancelScheduledUpload(true);
        memory.pendingDiff = remoteDiff(local, remote, localHash, remoteHash);
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
        cancelScheduledUpload(true);
        memory.pendingDiff = remoteDiff(local, remote, localHash, remoteHash);
        memory.gistUrl = remote.htmlUrl;
        await setStatus({ phase: "conflict", message: "Choose the local or remote snapshot", gistId: remote.gistId, remoteUpdatedAt: remote.updatedAt });
        return;
      }
    }

    remote = await client.update(remote.gistId, local, remote);
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
    throw error;
  }
}

async function importFromChrome(): Promise<void> {
  bookmarks = await readBookmarks();
  memory.bookmarkBarHash = await sha256(JSON.stringify(bookmarks));
  memory.localUpdatedAt = touchLocalUpdatedAt();
  await refreshPendingDiffLeft();
  scheduleUpload();
  await saveMemory();
  armPendingUpload();
  await publishToast("Chrome bookmarks imported");
}

function scheduleUpload(): void {
  if (memory.pendingDiff || memory.restoreJournal || !canAutoUpload(memory.syncEnabled, memory.token, memory.gistId, restoring)) {
    cancelScheduledUpload(true);
    return;
  }
  cancelScheduledUpload();
  memory.pendingUpload = { dueAt: Date.now() + UPLOAD_DEBOUNCE_MS, attempts: 0 };
}

function armPendingUpload(): void {
  if (!pendingDiffReady) return;
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = undefined;
  }
  const pending = memory.pendingUpload;
  if (!pending || memory.pendingDiff || memory.restoreJournal || !canAutoUpload(memory.syncEnabled, memory.token, memory.gistId, restoring)) {
    void chrome.alarms.clear(UPLOAD_ALARM).catch(() => undefined);
    return;
  }
  const delay = Math.max(0, pending.dueAt - Date.now());
  uploadTimer = setTimeout(triggerPendingUpload, delay);
  void chrome.alarms.create(UPLOAD_ALARM, { when: Math.max(pending.dueAt, Date.now() + 1) }).catch(() => undefined);
}

function triggerPendingUpload(): void {
  if (pendingUploadRunning || !memory.pendingUpload) return;
  if (memory.pendingUpload.dueAt > Date.now()) {
    armPendingUpload();
    return;
  }
  pendingUploadRunning = true;
  cancelScheduledUpload();
  void queue(async () => {
    await ensurePendingDiffReady();
    if (!memory.pendingUpload) return;
    if (memory.pendingUpload.dueAt > Date.now()) return;
    if (memory.pendingDiff || memory.restoreJournal || !canAutoUpload(memory.syncEnabled, memory.token, memory.gistId, restoring)) {
      cancelScheduledUpload(true);
      await saveMemory();
      return;
    }
    try {
      await upload(false);
      await markStartupChecked();
    } catch (error) {
      if (isBadCredentials(error)) {
        await deactivateRemoteSync("Invalid GitHub token");
        return;
      }
      if ((!isRetryableGitHubError(error) && !(error instanceof StorageCommitError)) || !memory.pendingUpload) {
        cancelScheduledUpload(true);
        await setStatusBestEffort({ phase: "error", message: errorMessage(error), gistId: memory.gistId });
        return;
      }
      const attempts = memory.pendingUpload.attempts + 1;
      const retryDelay = Math.min(UPLOAD_RETRY_MAX_MS, UPLOAD_DEBOUNCE_MS * 2 ** Math.min(attempts, 5));
      memory.pendingUpload = { dueAt: Math.max(Date.now() + retryDelay, error instanceof GitHubError ? (error.retryAt ?? 0) : 0), attempts };
      await setStatusBestEffort({ phase: "error", message: errorMessage(error), gistId: memory.gistId });
    }
  })
    .catch(async (error) => {
      await setStatusBestEffort({ phase: "error", message: errorMessage(error), gistId: memory.gistId });
    })
    .finally(() => {
      pendingUploadRunning = false;
      if (memory.pendingUpload) armPendingUpload();
    });
}

async function compareRemote(): Promise<void> {
  assertRestoreComplete();
  try {
    const client = await connectedClient();
    const remote = await resolveGist(client, false);
    if (!remote) throw new Error("No remote snapshot found");
    await queueLocal(async () => {
      bookmarks = await readBookmarks();
      const local = validateSnapshot(currentSnapshot());
      const [localHash, remoteHash] = await Promise.all([snapshotHash(local), snapshotHash(remote.snapshot)]);
      if (localHash === remoteHash) {
        await commitBaseline(local, remote);
        await publishRemoteResult(remote, "Local and remote match");
        return;
      }
      memory.pendingDiff = remoteDiff(local, remote, localHash, remoteHash);
      cancelScheduledUpload(true);
      memory.gistUrl = remote.htmlUrl;
      await setStatus({ phase: "conflict", message: "Local and remote differ. Choose a snapshot.", gistId: remote.gistId, remoteUpdatedAt: remote.updatedAt });
      await publishRemoteResult(remote);
    });
  } catch (error) {
    if (isBadCredentials(error)) {
      await deactivateRemoteSync("Invalid GitHub token");
      return;
    }
    throw error;
  }
}

async function useLocal(diffId: string): Promise<void> {
  const diff = requirePendingDiff(diffId);
  bookmarks = await readBookmarks();
  const local = currentSnapshot();
  const leftHash = await snapshotHash(local);
  if (leftHash !== diff.leftHash) {
    memory.pendingDiff = remoteDiff(
      local,
      {
        gistId: diff.gistId,
        updatedAt: diff.remoteUpdatedAt,
        snapshot: diff.right
      },
      leftHash,
      diff.rightHash
    );
    await setStatusBestEffort({
      phase: "conflict",
      message: "Local data changed. Review the updated comparison.",
      gistId: diff.gistId,
      remoteUpdatedAt: diff.remoteUpdatedAt
    });
    throw new HandledOperationError("Local data changed since the comparison. Review the latest diff before overwriting remote data.");
  }
  await upload(true, diff);
}

async function useRemote(diffId: string): Promise<void> {
  const diff = requirePendingDiff(diffId);
  if (!memory.gistId || memory.gistId !== diff.gistId) {
    throw new HandledOperationError("The Gist connection changed. Compare local and remote data again.");
  }
  const client = await connectedClient();
  const remote = await client.read(diff.gistId);
  await queueLocal(async () => {
    const remoteHash = await snapshotHash(remote.snapshot);
    bookmarks = await readBookmarks();
    const local = currentSnapshot();
    const localHash = await snapshotHash(local);
    if (remoteHash !== diff.rightHash || remote.updatedAt !== diff.remoteUpdatedAt || localHash !== diff.leftHash) {
      memory.pendingDiff = remoteDiff(local, remote, localHash, remoteHash);
      memory.gistUrl = remote.htmlUrl;
      await setStatusBestEffort({
        phase: "conflict",
        message: "Local or remote data changed. Review the updated comparison.",
        gistId: remote.gistId,
        remoteUpdatedAt: remote.updatedAt
      });
      throw new HandledOperationError("The comparison is out of date. Review the latest diff before restoring.");
    }
    await restoreSnapshot(diff.right, "manual-restore", remote);
    memory.sync = { ...memory.sync!, message: "Restored remote snapshot" };
    await publishRemoteResult(remote, "Restored remote snapshot");
  });
}

async function clearDiff(diffId: string): Promise<void> {
  requirePendingDiff(diffId);
  memory.pendingDiff = undefined;
  await saveMemory();
  broadcast();
}

function validRestoreJournal(): { point: RecoveryPoint } | undefined {
  const journal = memory.restoreJournal;
  if (
    !journal ||
    typeof journal.recoveryPointId !== "string" ||
    !journal.recoveryPointId ||
    typeof journal.targetHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(journal.targetHash) ||
    typeof journal.startedAt !== "string" ||
    Number.isNaN(Date.parse(journal.startedAt))
  ) {
    return undefined;
  }
  const point = Array.isArray(memory.recoveryPoints) ? memory.recoveryPoints.find((candidate) => candidate?.id === journal.recoveryPointId) : undefined;
  if (!point) return undefined;
  try {
    validateSnapshot(point.snapshot);
    return { point };
  } catch {
    return undefined;
  }
}

async function recoverInterruptedRestore(): Promise<void> {
  if (!memory.restoreJournal) return;
  const recovery = validRestoreJournal();
  cancelScheduledUpload(true);
  if (!recovery) {
    memory.syncEnabled = false;
    memory.baseline = undefined;
    memory.pendingDiff = undefined;
    memory.sync = { phase: "error", message: "Interrupted restore journal is invalid. Automatic sync was disabled.", gistId: memory.gistId };
    memory.toast = { id: crypto.randomUUID(), message: memory.sync.message, expiresAt: Date.now() + 10_000 };
    return;
  }

  restoring = true;
  try {
    await overwriteAndVerifySnapshot(recovery.point.snapshot);
    await commitMemory({
      restoreJournal: undefined,
      sync: { phase: "error", message: "An interrupted restore was rolled back to the previous local snapshot.", gistId: memory.gistId }
    });
  } catch (error) {
    memory.syncEnabled = false;
    memory.baseline = undefined;
    memory.pendingDiff = undefined;
    memory.sync = {
      phase: "error",
      message: `Interrupted restore rollback failed: ${errorMessage(error)}. Automatic sync was disabled.`,
      gistId: memory.gistId
    };
  } finally {
    restoring = false;
    memory.toast = { id: crypto.randomUUID(), message: memory.sync!.message, expiresAt: Date.now() + 10_000 };
  }
}

type SettingsRepair = "none" | "fields" | "reset";

function normalizeStoredSettings(raw: unknown): { settings: SyncedSettings; changed: boolean; repair: SettingsRepair; fields: string[] } {
  const inspected = inspectSettings(raw);
  if (raw === undefined) return { ...inspected, changed: true, repair: "none" };
  return { ...inspected, changed: inspected.repair !== "none" };
}

async function validatePendingDiff(): Promise<boolean> {
  let memoryChanged = false;
  if (memory.pendingDiff) {
    try {
      const candidate = memory.pendingDiff as DiffPayload;
      const left = validateSnapshot(candidate.left);
      const right = validateSnapshot(candidate.right);
      const [leftHash, rightHash] = await Promise.all([snapshotHash(left), snapshotHash(right)]);
      if (
        candidate.source !== "remote" ||
        typeof candidate.gistId !== "string" ||
        !candidate.gistId ||
        typeof candidate.remoteUpdatedAt !== "string" ||
        !candidate.remoteUpdatedAt ||
        candidate.leftHash !== leftHash ||
        candidate.rightHash !== rightHash ||
        candidate.id !== createDiffId("remote", leftHash, rightHash, candidate.remoteUpdatedAt)
      ) {
        throw new Error("Invalid stored diff metadata");
      }
      memory.pendingDiff = { ...candidate, left, right, leftHash, rightHash };
    } catch {
      memory.pendingDiff = undefined;
      memoryChanged = true;
    }
  }
  return memoryChanged;
}

async function refreshStoredDiff(): Promise<boolean> {
  let memoryChanged = false;
  if (memory.pendingDiff) {
    const local = currentSnapshot();
    const leftHash = await snapshotHash(local);
    if (leftHash !== memory.pendingDiff.leftHash) {
      memory.pendingDiff = remoteDiff(
        local,
        {
          gistId: memory.pendingDiff.gistId,
          updatedAt: memory.pendingDiff.remoteUpdatedAt,
          snapshot: memory.pendingDiff.right
        },
        leftHash,
        memory.pendingDiff.rightHash
      );
      memory.sync = {
        phase: "conflict",
        message: "Local data changed. Review the updated comparison.",
        gistId: memory.pendingDiff.gistId,
        remoteUpdatedAt: memory.pendingDiff.remoteUpdatedAt
      };
      memoryChanged = true;
    }
  }
  return memoryChanged;
}

let pendingDiffLoading: Promise<void> | undefined;
let pendingDiffReady = true;

function ensurePendingDiffReady(): Promise<void> {
  if (pendingDiffReady) return Promise.resolve();
  pendingDiffLoading ??= (async () => {
    memory.pendingDiff = await repository.loadPendingDiff();
    let changed = await validatePendingDiff();
    if (await refreshStoredDiff()) changed = true;
    if (memory.pendingDiff && memory.pendingUpload) {
      cancelScheduledUpload(true);
      changed = true;
    }
    if (changed) await saveMemory();
    pendingDiffReady = true;
    broadcast();
    armPendingUpload();
  })().catch((error) => {
    pendingDiffLoading = undefined;
    throw error;
  });
  return pendingDiffLoading;
}

async function initialize(): Promise<void> {
  if (initialized) return;
  memory = await repository.load({ deferRecoveryPoints: true, deferPendingDiff: true });
  pendingDiffReady = !repository.pendingDiffDeferred;
  const startupSession = await chrome.storage.session.get([STARTUP_SESSION_KEY]);
  startupRemoteCheckRequested = startupSession[STARTUP_SESSION_KEY] === true;
  let memoryChanged = false;
  const normalizedSettings = normalizeStoredSettings(memory.settings);
  memory.settings = normalizedSettings.settings;
  memoryChanged ||= normalizedSettings.changed;
  if (memory.settingsVersion !== SETTINGS_VERSION) {
    memory.settingsVersion = SETTINGS_VERSION;
    memoryChanged = true;
  }
  openSetupOnLaunch = !memory.setupSeen;
  if (!memory.localUpdatedAt) {
    memory.localUpdatedAt = eastEightTimestamp();
    memoryChanged = true;
  }
  try {
    memory.notes = validateNotes(memory.notes);
  } catch (error) {
    throw new Error(`Stored Notes are invalid and were left unchanged: ${errorMessage(error)}`, { cause: error });
  }
  if (memory.toast && (!Number.isFinite(memory.toast.expiresAt) || memory.toast.expiresAt <= Date.now())) {
    memory.toast = undefined;
    memoryChanged = true;
  }
  if (
    memory.pendingUpload &&
    (typeof memory.pendingUpload.dueAt !== "number" ||
      !Number.isFinite(memory.pendingUpload.dueAt) ||
      typeof memory.pendingUpload.attempts !== "number" ||
      !Number.isInteger(memory.pendingUpload.attempts) ||
      memory.pendingUpload.attempts < 0)
  ) {
    memory.pendingUpload = undefined;
    memoryChanged = true;
  }
  if (
    memory.baseline &&
    (typeof memory.baseline.localHash !== "string" ||
      typeof memory.baseline.remoteHash !== "string" ||
      typeof memory.baseline.remoteUpdatedAt !== "string" ||
      memory.baseline.localHash !== memory.baseline.remoteHash)
  ) {
    memory.baseline = undefined;
    memoryChanged = true;
  }
  if (await validatePendingDiff()) memoryChanged = true;

  if (normalizedSettings.repair !== "none") {
    const message =
      normalizedSettings.repair === "reset"
        ? "Stored settings were invalid and were reset to safe defaults"
        : `Some stored settings were invalid and were repaired${normalizedSettings.fields.length ? ` (${normalizedSettings.fields.join(", ")})` : ""}`;
    memory.toast = { id: crypto.randomUUID(), message, expiresAt: Date.now() + 10_000 };
    memory.baseline = undefined;
    memory.localUpdatedAt = eastEightTimestamp();
    memoryChanged = true;
  }
  if (!memory.token && memory.sync?.phase !== "local-only") {
    memory.sync = { phase: "local-only", message: "Local only" };
    memoryChanged = true;
  }
  if (memory.token && (!memory.syncEnabled || !memory.gistId) && memory.sync?.phase !== "local-only") {
    memory.sync = { phase: "local-only", message: "Remote not configured" };
    memoryChanged = true;
  }
  if (
    !memory.restoreJournal &&
    memory.token &&
    memory.gistId &&
    memory.sync &&
    (memory.sync.phase === "uploading" || memory.sync.phase === "restoring" || memory.sync.phase === "discovering")
  ) {
    memory.sync = { phase: "discovering", message: "Checking remote…", gistId: memory.gistId };
    memoryChanged = true;
  }
  bookmarks = await readBookmarks();
  if (memory.restoreJournal) {
    await recoverInterruptedRestore();
    bookmarks = await readBookmarks();
    memoryChanged = true;
  }
  // Initializing from Chrome is an observation, not acknowledgement of a change
  // event. Preserve the last persisted bookmark hash across worker restarts.
  if (!memory.bookmarkBarHash && (!memory.baseline || (await snapshotHash(currentSnapshot())) === memory.baseline.localHash)) {
    memory.bookmarkBarHash = await sha256(JSON.stringify(bookmarks));
  }
  if (memory.pendingUpload && (memory.pendingDiff || memory.restoreJournal || !canAutoUpload(memory.syncEnabled, memory.token, memory.gistId, restoring))) {
    memory.pendingUpload = undefined;
    memoryChanged = true;
  }
  if (await refreshStoredDiff()) memoryChanged = true;
  if (memoryChanged) await saveMemory();
  initialized = true;
  broadcast();
  armPendingUpload();
  if (!pendingDiffReady) {
    setTimeout(() => {
      void queueLocal(ensurePendingDiffReady).catch((error) =>
        setStatusBestEffort({ phase: "error", message: `Unable to load the saved comparison: ${errorMessage(error)}`, gistId: memory.gistId })
      );
    }, 0);
  }
}

function ensureInitialized(): Promise<void> {
  if (initialized) return Promise.resolve();
  initializing ??= initialize().catch((error) => {
    initializing = undefined;
    throw error;
  });
  return initializing;
}

async function handle(request: ExtensionRequest): Promise<AppState> {
  await ensureInitialized();
  await ensurePendingDiffReady();
  switch (request.type) {
    case "GET_STATE":
      break;
    case "SAVE_SETTINGS":
      memory.settings = settingsFromSnapshot(validateSnapshot(snapshotFrom([], request.settings, [])));
      memory.localUpdatedAt = touchLocalUpdatedAt();
      await refreshPendingDiffLeft();
      scheduleUpload();
      await saveMemory();
      broadcast();
      armPendingUpload();
      break;
    case "SAVE_NOTES":
      memory.notes = validateSnapshot(snapshotFrom([], currentSettings(), request.notes)).notes.map((note) => ({
        ...note,
        createtime: note.createtime,
        updatetime: note.updatetime
      }));
      memory.localUpdatedAt = touchLocalUpdatedAt();
      await refreshPendingDiffLeft();
      scheduleUpload();
      await saveMemory();
      broadcast();
      armPendingUpload();
      break;
    case "SAVE_TOKEN":
      await saveToken(request.token, request.rememberToken ?? false);
      break;
    case "UPLOAD_NOW":
      await upload(true);
      break;
    case "IMPORT_BOOKMARKS":
      await importFromChrome();
      break;
    case "COMPARE_REMOTE":
      await compareRemote();
      break;
    case "USE_LOCAL":
      await useLocal(request.diffId);
      break;
    case "USE_REMOTE":
      await useRemote(request.diffId);
      break;
    case "CLEAR_DIFF":
      await clearDiff(request.diffId);
      break;
    case "OPEN_BOOKMARK_MANAGER":
      await chrome.tabs.create({ url: "chrome://bookmarks/" });
      break;
    default:
      throw new Error("Unsupported extension request");
  }
  return appState();
}

chrome.runtime.onMessage.addListener((rawRequest: unknown, _sender, sendResponse: (response: ExtensionResponse) => void) => {
  let request: ExtensionRequest;
  try {
    request = parseExtensionRequest(rawRequest);
  } catch (error) {
    sendResponse({ ok: false, state: appState(), error: errorMessage(error) });
    return false;
  }
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
  const enqueue = request.type === "SAVE_NOTES" || request.type === "SAVE_SETTINGS" || request.type === "IMPORT_BOOKMARKS" ? queueLocal : queue;
  enqueue(async () => {
    const before = appState();
    const state = await handle(request);
    return request.compact ? { ok: true, patch: statePatch(before, state) } : { ok: true, state };
  })
    .then(sendResponse)
    .catch(async (error) => {
      const message = errorMessage(error);
      try {
        if (!(error instanceof HandledOperationError)) {
          if (isBadCredentials(error)) await deactivateRemoteSync("Invalid GitHub token");
          else await setStatusBestEffort({ phase: "error", message, gistId: memory.gistId });
        }
      } catch {
        memory.sync = { phase: "error", message, gistId: memory.gistId };
      } finally {
        try {
          sendResponse({ ok: false, state: appState(), error: message });
        } catch (responseError) {
          sendResponse({ ok: false, error: `${message}; ${errorMessage(responseError)}` });
        }
      }
    });
  return true;
});

let bookmarkChangeTimer: ReturnType<typeof setTimeout> | undefined;

const persistBookmarkChanges = () => {
  if (restoring) return;
  queueLocal(async () => {
    await ensureInitialized();
    await ensurePendingDiffReady();
    const next = await readBookmarks();
    const bookmarkBarHash = await sha256(JSON.stringify(next));
    if (next === bookmarks && bookmarkBarHash === memory.bookmarkBarHash) return;
    bookmarks = next;
    memory.bookmarkBarHash = bookmarkBarHash;
    memory.localUpdatedAt = touchLocalUpdatedAt();
    await refreshPendingDiffLeft();
    scheduleUpload();
    await saveMemory();
    broadcast();
    armPendingUpload();
  }).catch(async (error) => {
    try {
      if (isBadCredentials(error)) await deactivateRemoteSync("Invalid GitHub token");
      else await setStatusBestEffort({ phase: "error", message: `Bookmark change was not saved: ${errorMessage(error)}`, gistId: memory.gistId });
    } catch {
      memory.sync = { phase: "error", message: `Bookmark change was not saved: ${errorMessage(error)}`, gistId: memory.gistId };
    }
  });
};

const onBookmarksChanged = () => {
  if (restoring) return;
  if (bookmarkChangeTimer) clearTimeout(bookmarkChangeTimer);
  bookmarkChangeTimer = setTimeout(() => {
    bookmarkChangeTimer = undefined;
    persistBookmarkChanges();
  }, 100);
};

chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
chrome.bookmarks.onMoved.addListener(onBookmarksChanged);
chrome.bookmarks.onChildrenReordered.addListener(onBookmarksChanged);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPLOAD_ALARM) {
    void ensureInitialized()
      .then(triggerPendingUpload)
      .catch(() => undefined);
  }
});
chrome.runtime.onInstalled.addListener(() => {
  void ensureInitialized().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  void ensureInitialized()
    .then(async () => {
      await chrome.storage.session.set({ [STARTUP_SESSION_KEY]: false });
      startupRemoteCheckRequested = false;
      scheduleStartupRemoteCheck();
    })
    .catch(() => undefined);
});
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({});
});
void ensureInitialized().catch(() => undefined);
