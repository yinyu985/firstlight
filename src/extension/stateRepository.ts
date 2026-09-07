import type { StoredState } from "../shared/protocol";

const METADATA_KEY = "firstlight";
const LARGE_FIELDS = ["notes", "pendingDiff", "recoveryPoints"] as const;
type LargeField = (typeof LARGE_FIELDS)[number];
const keyFor = (field: LargeField) => `firstlight.${field}`;

interface StorageArea {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

/** All fields are replaced immutably. Unchanged snapshots never enter a write. */
export class StateRepository {
  private persisted: Partial<StoredState> = {};
  private migrated = false;

  constructor(
    private readonly storage: StorageArea,
    private readonly session: StorageArea
  ) {}

  async load(): Promise<StoredState> {
    const values = await this.storage.get([METADATA_KEY, ...LARGE_FIELDS.map(keyFor)]);
    const metadata = values[METADATA_KEY] as (StoredState & { storageVersion?: number }) | undefined;
    this.migrated = metadata?.storageVersion === 2;
    const state: StoredState = { ...metadata };
    state.rememberToken ??= Boolean(state.token);
    if (!state.rememberToken) {
      const sessionValues = await this.session.get(["firstlight.token"]);
      state.token = typeof sessionValues["firstlight.token"] === "string" ? sessionValues["firstlight.token"] : undefined;
    }
    if (this.migrated) {
      for (const field of LARGE_FIELDS) {
        Object.assign(state, { [field]: values[keyFor(field)] ?? undefined });
      }
    }
    this.persisted = { ...state };
    return state;
  }

  async save(state: StoredState): Promise<void> {
    const { notes: _notes, pendingDiff: _diff, recoveryPoints: _points, token, ...metadata } = state;
    const writes: Record<string, unknown> = {
      [METADATA_KEY]: { ...metadata, ...(state.rememberToken !== false && token ? { token } : {}), storageVersion: 2 }
    };
    for (const field of LARGE_FIELDS) {
      if (!this.migrated || state[field] !== this.persisted[field]) {
        // null is explicit deletion: JSON-based Chrome messaging drops undefined.
        writes[keyFor(field)] = state[field] ?? null;
      }
    }
    // The migration and metadata commit share one storage operation. A failed
    // write leaves the old document intact and must not advance our cache.
    if (!this.migrated || token !== this.persisted.token || state.rememberToken !== this.persisted.rememberToken) {
      await this.session.set({ "firstlight.token": state.rememberToken === false ? (token ?? null) : null });
    }
    await this.storage.set(writes);
    this.persisted = { ...state };
    this.migrated = true;
  }
}
