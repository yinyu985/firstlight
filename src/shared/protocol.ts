import type {
  BookmarkItem,
  SyncNote,
  DiffPayload,
  RecoveryPoint,
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
  tokenConfigured: boolean;
  openSetupOnLaunch: boolean;
}

export type ExtensionRequest =
  | { type: "GET_STATE" }
  | { type: "SAVE_SETTINGS"; settings: SyncedSettings }
  | { type: "SAVE_TOKEN"; token: string }
  | { type: "SAVE_NOTES"; notes: SyncNote[] }
  | { type: "UPLOAD_NOW" }
  | { type: "IMPORT_BOOKMARKS" }
  | { type: "COMPARE_REMOTE" }
  | { type: "USE_LOCAL"; diffId: string }
  | { type: "USE_REMOTE"; diffId: string }
  | { type: "CLEAR_DIFF"; diffId: string }
  | { type: "OPEN_BOOKMARK_MANAGER" };

export interface ExtensionResponse {
  ok: boolean;
  state?: AppState;
  error?: string;
}

export interface StoredState {
  syncEnabled?: boolean;
  token?: string;
  gistId?: string;
  gistUrl?: string;
  localUpdatedAt?: string;
  settings?: SyncedSettings;
  baseline?: import("./model").SyncBaseline;
  recoveryPoints?: RecoveryPoint[];
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
