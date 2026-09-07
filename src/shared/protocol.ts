import type {
  BookmarkItem,
  SyncNote,
  DiffPayload,
  PendingUpload,
  RecoveryPoint,
  RestoreJournal,
  Snapshot,
  SyncedSettings,
  SyncStatus,
  ToastNotice
} from "./model";

export interface AppState {
  target: "extension" | "online";
  bookmarks: BookmarkItem[];
  notes?: SyncNote[];
  settings: SyncedSettings;
  sync: SyncStatus;
  toast?: ToastNotice;
  diff?: DiffPayload;
  gistUrl?: string;
  token?: string;
  rememberToken?: boolean;
  tokenConfigured: boolean;
  openSetupOnLaunch: boolean;
}

export type ExtensionRequest = (
  | { type: "GET_STATE" }
  | { type: "SAVE_SETTINGS"; settings: SyncedSettings }
  | { type: "SAVE_TOKEN"; token: string; rememberToken?: boolean }
  | { type: "SAVE_NOTES"; notes: SyncNote[] }
  | { type: "UPLOAD_NOW" }
  | { type: "IMPORT_BOOKMARKS" }
  | { type: "COMPARE_REMOTE" }
  | { type: "USE_LOCAL"; diffId: string }
  | { type: "USE_REMOTE"; diffId: string }
  | { type: "CLEAR_DIFF"; diffId: string }
  | { type: "OPEN_BOOKMARK_MANAGER" }
) & { compact?: boolean };

export interface ExtensionResponse {
  ok: boolean;
  state?: AppState;
  patch?: import("./statePatch").StatePatch;
  error?: string;
  retryable?: boolean;
}

export interface StoredState {
  settingsVersion?: number;
  syncEnabled?: boolean;
  token?: string;
  rememberToken?: boolean;
  /** Old token stays in its existing store until the remote rekey and local commit succeed. */
  tokenMigration?: { id: string; gistId: string; token?: string; rememberToken: boolean };
  gistId?: string;
  gistUrl?: string;
  localUpdatedAt?: string;
  bookmarkBarHash?: string;
  settings?: SyncedSettings;
  baseline?: import("./model").SyncBaseline;
  recoveryPoints?: RecoveryPoint[];
  restoreJournal?: RestoreJournal;
  pendingUpload?: PendingUpload;
  sync?: SyncStatus;
  toast?: ToastNotice;
  notes?: SyncNote[];
  pendingDiff?: DiffPayload;
  setupSeen?: boolean;
}

export interface OnlineState {
  token?: string;
  gistId?: string;
  snapshot?: Snapshot;
}
