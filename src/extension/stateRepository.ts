import type { StoredState } from "../shared/protocol";

const METADATA_KEY = "firstlight";
const LARGE_FIELDS = ["notes", "pendingDiff", "recoveryPoints"] as const;
type LargeField = (typeof LARGE_FIELDS)[number];
const keyFor = (field: LargeField) => `firstlight.${field}`;

interface StorageArea {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

export class StorageCommitError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Unable to persist extension state", { cause });
    this.name = "StorageCommitError";
  }
}

/** All fields are replaced immutably. Unchanged snapshots never enter a write. */
export class StateRepository {
  private persisted: Partial<StoredState> = {};
  private migrated = false;
  private connectionVersion: string | undefined;
  private writes = Promise.resolve();
  private recoveryDeferred = false;
  private diffDeferred = false;

  get pendingDiffDeferred(): boolean {
    return this.diffDeferred;
  }

  constructor(
    private readonly storage: StorageArea,
    private readonly session: StorageArea
  ) {}

  async load(options: { deferRecoveryPoints?: boolean; deferPendingDiff?: boolean } = {}): Promise<StoredState> {
    const values = await this.storage.get([
      METADATA_KEY,
      ...LARGE_FIELDS.filter(
        (field) => !(options.deferRecoveryPoints && field === "recoveryPoints") && !(options.deferPendingDiff && field === "pendingDiff")
      ).map(keyFor)
    ]);
    const metadata = values[METADATA_KEY] as (StoredState & { storageVersion?: number; connectionVersion?: string }) | undefined;
    this.connectionVersion = metadata?.connectionVersion;
    this.migrated = metadata?.storageVersion === 2;
    const state: StoredState = { ...metadata };
    let connectionInterrupted = false;
    state.rememberToken ??= Boolean(state.token);
    if (!state.rememberToken) {
      const sessionValues = await this.session.get(["firstlight.token", "firstlight.connectionVersion"]);
      const consistent = (sessionValues["firstlight.connectionVersion"] ?? undefined) === this.connectionVersion;
      state.token = consistent && typeof sessionValues["firstlight.token"] === "string" ? sessionValues["firstlight.token"] : undefined;
      if (!consistent) {
        connectionInterrupted = true;
        state.gistId = undefined;
        state.gistUrl = undefined;
        state.baseline = undefined;
        state.syncEnabled = false;
        state.pendingUpload = undefined;
        state.sync = { phase: "local-only", message: "The saved connection was interrupted. Save your token again." };
      }
    }
    if (state.tokenMigration && !state.tokenMigration.rememberToken) {
      const values = await this.session.get(["firstlight.tokenMigration"]);
      const pending = values["firstlight.tokenMigration"] as { id?: string; token?: string } | undefined;
      state.tokenMigration = { ...state.tokenMigration, token: pending?.id === state.tokenMigration.id ? pending.token : undefined };
    }
    if (state.tokenMigration) {
      state.syncEnabled = false;
      state.pendingUpload = undefined;
      state.sync = { phase: "error", message: "Token migration is incomplete. Save the replacement token again to resume." };
    }
    if (this.migrated) {
      this.recoveryDeferred = Boolean(options.deferRecoveryPoints && !state.restoreJournal);
      this.diffDeferred = Boolean(options.deferPendingDiff && !state.restoreJournal && !connectionInterrupted);
      if (options.deferRecoveryPoints && state.restoreJournal) Object.assign(values, await this.storage.get([keyFor("recoveryPoints")]));
      if (options.deferPendingDiff && !this.diffDeferred) Object.assign(values, await this.storage.get([keyFor("pendingDiff")]));
      for (const field of LARGE_FIELDS) {
        if (field === "pendingDiff" && this.diffDeferred) {
          state.pendingDiff = undefined;
          continue;
        }
        if (field === "recoveryPoints" && this.recoveryDeferred) {
          state.recoveryPoints = undefined;
          continue;
        }
        Object.assign(state, { [field]: values[keyFor(field)] ?? undefined });
      }
    }
    this.persisted = { ...state };
    // Cache what was actually read so the next commit writes the invalidated
    // diff's tombstone instead of mistaking the in-memory clear for a disk clear.
    if (connectionInterrupted) state.pendingDiff = undefined;
    return state;
  }

  async loadPendingDiff(): Promise<StoredState["pendingDiff"]> {
    if (this.diffDeferred) {
      const values = await this.storage.get([keyFor("pendingDiff")]);
      this.persisted.pendingDiff = values[keyFor("pendingDiff")] as StoredState["pendingDiff"];
      this.diffDeferred = false;
    }
    return this.persisted.pendingDiff;
  }

  async loadRecoveryPoints(): Promise<StoredState["recoveryPoints"]> {
    if (this.recoveryDeferred) {
      const values = await this.storage.get([keyFor("recoveryPoints")]);
      this.persisted.recoveryPoints = values[keyFor("recoveryPoints")] as StoredState["recoveryPoints"];
      this.recoveryDeferred = false;
    }
    return this.persisted.recoveryPoints;
  }

  async save(state: StoredState): Promise<void> {
    const candidate = { ...state };
    const deferred = new Set<LargeField>();
    if (this.diffDeferred) deferred.add("pendingDiff");
    if (this.recoveryDeferred) deferred.add("recoveryPoints");
    const pending = this.writes
      .then(() => this.commit(candidate, deferred))
      .catch((cause: unknown) => {
        throw new StorageCommitError(cause);
      });
    this.writes = pending.catch(() => undefined);
    return pending;
  }

  private async commit(state: StoredState, deferred: Set<LargeField>): Promise<void> {
    const { notes: _notes, pendingDiff: _diff, recoveryPoints: _points, token, tokenMigration, ...metadata } = state;
    const migrationChanged = tokenMigration !== this.persisted.tokenMigration;
    const storedMigration = tokenMigration ? { ...tokenMigration, token: tokenMigration.rememberToken ? tokenMigration.token : undefined } : undefined;
    const connectionChanged = !this.migrated || token !== this.persisted.token || state.rememberToken !== this.persisted.rememberToken;
    const connectionVersion = connectionChanged ? crypto.randomUUID() : this.connectionVersion;
    const writes: Record<string, unknown> = {
      [METADATA_KEY]: {
        ...metadata,
        ...(state.rememberToken !== false && token ? { token } : {}),
        tokenMigration: storedMigration,
        connectionVersion,
        storageVersion: 2
      }
    };
    for (const field of LARGE_FIELDS) {
      if (deferred.has(field)) continue;
      if (!this.migrated || state[field] !== this.persisted[field]) {
        // null is explicit deletion: JSON-based Chrome messaging drops undefined.
        writes[keyFor(field)] = state[field] ?? null;
      }
    }
    // The migration and metadata commit share one storage operation. A failed
    // write leaves the old document intact and must not advance our cache.
    // Stage the new credential before publishing the journal; never erase it until
    // the final connection commit succeeds (including its possible rollback).
    if (migrationChanged && tokenMigration) {
      await this.session.set({
        "firstlight.tokenMigration": tokenMigration.rememberToken ? null : { id: tokenMigration.id, token: tokenMigration.token ?? null }
      });
    }
    if (connectionChanged) {
      await this.session.set({ "firstlight.token": state.rememberToken === false ? (token ?? null) : null, "firstlight.connectionVersion": connectionVersion });
    }
    try {
      await this.storage.set(writes);
    } catch (error) {
      if (connectionChanged) {
        // If this rollback also fails, load() rejects the mismatched binding.
        await this.session
          .set({
            "firstlight.token": this.persisted.rememberToken === false ? (this.persisted.token ?? null) : null,
            "firstlight.connectionVersion": this.connectionVersion ?? null
          })
          .catch(() => undefined);
      }
      throw error;
    }
    if (migrationChanged && !tokenMigration) await this.session.set({ "firstlight.tokenMigration": null }).catch(() => undefined);
    this.connectionVersion = connectionVersion;
    const persisted = { ...state };
    for (const field of deferred) Object.assign(persisted, { [field]: this.persisted[field] });
    this.persisted = persisted;
    this.migrated = true;
  }
}
