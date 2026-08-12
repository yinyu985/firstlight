export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_FILE_NAME = "firstlight.json";
export const GIST_DESCRIPTION = "Firstlight bookmark snapshot";
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

export type OpenTarget = "new-tab" | "current-tab";

export type Background =
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number }
  | { type: "dynamic"; from: string; to: string; angle: number; speed: number };

export interface Foreground {
  color: string;
  fontSize: number;
}

export interface SyncNote {
  id: string;
  name: string;
  content: string;
  createtime: string;
  updatetime: string;
}

export type BookmarkAlignment = "left" | "center" | "right";

export interface HomeLayout {
  rows: number;
  columns: number;
  bookmarkAlignment: BookmarkAlignment;
}

export type ClockPosition = "hidden" | "left" | "center" | "right";

export type HoverStyle = "underline" | "box" | "block";
export type ThemeMode = "dark" | "light";

export interface Features {
  searchPosition: ClockPosition;
  searchIcon: boolean;
  searchText: boolean;
  bookmarkDetails: boolean;
  clockSeconds: boolean;
  hoverStyle: HoverStyle;
  hoverColor: string;
  themeMode: ThemeMode;
}

export interface BookmarkItem {
  title: string;
  url?: string;
  children?: BookmarkItem[];
}

export interface SyncedSettings {
  openTarget: OpenTarget;
  background: Background;
  foreground: Foreground;
  layout: HomeLayout;
  clockPosition: ClockPosition;
  features: Features;
}

export interface Snapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  updatedAt: string;
  config: SyncedSettings;
  bookmarks: BookmarkItem[];
  notes: SyncNote[];
}

export interface SyncBaseline {
  localHash: string;
  remoteHash: string;
  remoteUpdatedAt: string;
}

export type RecoveryReason = "manual-restore";

export interface RecoveryPoint {
  id: string;
  createdAt: string;
  reason: RecoveryReason;
  snapshot: Snapshot;
}

export type SyncPhase =
  | "local-only"
  | "discovering"
  | "synced"
  | "uploading"
  | "restoring"
  | "conflict"
  | "error";

export interface SyncStatus {
  phase: SyncPhase;
  message: string;
  gistId?: string;
  remoteUpdatedAt?: string;
}

export interface ToastNotice {
  id: string;
  message: string;
  expiresAt: number;
}

export interface DiffPayload {
  source: "remote";
  left: Snapshot;
  right: Snapshot;
}

export const DEFAULT_SETTINGS: SyncedSettings = {
  openTarget: "new-tab",
  background: {
    type: "gradient",
    from: "#070b12",
    to: "#13242a",
    angle: 145
  },
  foreground: {
    color: "#e8f0ed",
    fontSize: 12
  },
  layout: {
    rows: 3,
    columns: 4,
    bookmarkAlignment: "center"
  },
  clockPosition: "left",
  features: {
    searchPosition: "left",
    searchIcon: true,
    searchText: true,
    bookmarkDetails: true,
    clockSeconds: false,
    hoverStyle: "underline",
    hoverColor: "#59d5b8",
    themeMode: "dark"
  }
};

export function eastEightTimestamp(date = new Date()): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

export function canonicalSettings(settings: SyncedSettings): SyncedSettings {
  const background = settings.background.type === "solid"
    ? { type: "solid" as const, color: settings.background.color }
    : settings.background.type === "gradient"
      ? {
          type: "gradient" as const,
          from: settings.background.from,
          to: settings.background.to,
          angle: settings.background.angle
        }
      : {
          type: "dynamic" as const,
          from: settings.background.from,
          to: settings.background.to,
          angle: settings.background.angle,
          speed: settings.background.speed
        };
  return {
    openTarget: settings.openTarget,
    background,
    foreground: {
      color: settings.foreground.color,
      fontSize: settings.foreground.fontSize
    },
    layout: {
      rows: settings.layout.rows,
      columns: settings.layout.columns,
      bookmarkAlignment: settings.layout.bookmarkAlignment
    },
    clockPosition: settings.clockPosition,
    features: {
      searchPosition: settings.features.searchPosition,
      searchIcon: settings.features.searchIcon,
      searchText: settings.features.searchText,
      bookmarkDetails: settings.features.bookmarkDetails,
      clockSeconds: settings.features.clockSeconds,
      hoverStyle: settings.features.hoverStyle ?? "underline",
      hoverColor: settings.features.hoverColor ?? "#59d5b8",
      themeMode: settings.features.themeMode ?? "dark"
    }
  };
}

function canonicalNote(note: SyncNote): SyncNote {
  return {
    id: note.id,
    name: note.name,
    content: note.content,
    createtime: note.createtime,
    updatetime: note.updatetime
  };
}

export function canonicalBookmarks(nodes: BookmarkItem[]): BookmarkItem[] {
  return nodes.map((node) => node.url !== undefined
    ? { title: node.title, url: node.url }
    : { title: node.title, children: canonicalBookmarks(node.children ?? []) });
}

export function canonicalSnapshot(snapshot: Snapshot): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    updatedAt: snapshot.updatedAt,
    config: canonicalSettings(snapshot.config),
    bookmarks: canonicalBookmarks(snapshot.bookmarks),
    notes: snapshot.notes.map(canonicalNote)
  };
}

export function snapshotFrom(
  bookmarks: BookmarkItem[],
  settings: SyncedSettings,
  notes: SyncNote[] = [],
  updatedAt: string = eastEightTimestamp()
): Snapshot {
  return canonicalSnapshot({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    updatedAt,
    config: settings,
    bookmarks,
    notes
  });
}

export function settingsFromSnapshot(snapshot: Snapshot): SyncedSettings {
  return canonicalSettings(snapshot.config);
}
