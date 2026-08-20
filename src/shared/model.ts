import { isDynamicEffect, isDynamicEffectInput, normalizeDynamicEffect, normalizeDynamicParameters, normalizeDynamicSpeed, type DynamicEffect, type DynamicEffectParameters } from "./dynamicEffects";
export type { DynamicEffect, DynamicEffectParameters } from "./dynamicEffects";
export const SNAPSHOT_SCHEMA_VERSION = 2 as const;
export const SETTINGS_VERSION = 1 as const;
export const SNAPSHOT_FILE_NAME = "firstlight.json";
export const GIST_DESCRIPTION = "Firstlight bookmark snapshot";
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

export type OpenTarget = "new-tab" | "current-tab";

export type Background =
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number }
  | { type: "dynamic"; effect: DynamicEffect; from: string; to: string; angle: number; speed: number; parameters?: DynamicEffectParameters };

export interface DynamicEffectProfile {
  from: string;
  to: string;
  angle: number;
  speed: number;
  parameters?: DynamicEffectParameters;
}

export type DynamicEffectProfiles = Partial<Record<DynamicEffect, DynamicEffectProfile>>;

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
export type SearchTextPosition = ClockPosition;

export type HoverStyle = "underline" | "box" | "block";
export type ThemeMode = "dark" | "light";

export interface Features {
  searchPosition: ClockPosition;
  searchIcon: boolean;
  searchText: SearchTextPosition;
  bookmarkDetails: boolean;
  clockSeconds: boolean;
  hoverStyle: HoverStyle;
  themeColor: string;
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
  dynamicEffectProfiles?: DynamicEffectProfiles;
  foreground: Foreground;
  layout: HomeLayout;
  clockPosition: ClockPosition;
  features: Features;
}

export interface Snapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  settingsVersion: typeof SETTINGS_VERSION;
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

export interface RestoreJournal {
  recoveryPointId: string;
  targetHash: string;
  startedAt: string;
}

export interface PendingUpload {
  dueAt: number;
  attempts: number;
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
  id: string;
  source: "remote";
  leftHash: string;
  rightHash: string;
  gistId: string;
  remoteUpdatedAt: string;
  left: Snapshot;
  right: Snapshot;
}

export function createDiffId(source: "remote", leftHash: string, rightHash: string, remoteUpdatedAt: string): string {
  return `${source}:${leftHash}:${rightHash}:${remoteUpdatedAt}`;
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
    searchText: "left",
    bookmarkDetails: true,
    clockSeconds: false,
    hoverStyle: "underline",
    themeColor: "#59d5b8",
    themeMode: "dark"
  }
};

export function eastEightTimestamp(date = new Date()): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function validInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function validNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function validClockPosition(value: unknown, fallback: ClockPosition): ClockPosition {
  return value === "hidden" || value === "left" || value === "center" || value === "right" ? value : fallback;
}

export function normalizeSettings(input: unknown): SyncedSettings {
  const settings = settingsRecord(input);
  const rawBackground = settingsRecord(settings.background);
  const fallbackFrom = DEFAULT_SETTINGS.background.type === "solid"
    ? DEFAULT_SETTINGS.background.color
    : DEFAULT_SETTINGS.background.from;
  const fallbackTo = DEFAULT_SETTINGS.background.type === "solid"
    ? DEFAULT_SETTINGS.background.color
    : DEFAULT_SETTINGS.background.to;
  const fallbackAngle = DEFAULT_SETTINGS.background.type === "solid" ? 145 : DEFAULT_SETTINGS.background.angle;
  const background: Background = rawBackground.type === "solid"
    ? {
        type: "solid",
        color: validColor(rawBackground.color, fallbackFrom)
      }
    : rawBackground.type === "dynamic"
      ? (() => {
          const effect = normalizeDynamicEffect(rawBackground.effect);
          return {
            type: "dynamic",
            effect,
            from: validColor(rawBackground.from, fallbackFrom),
            to: validColor(rawBackground.to, fallbackTo),
            angle: validNumber(rawBackground.angle, 0, 360, fallbackAngle),
            speed: normalizeDynamicSpeed(effect, rawBackground.speed),
            parameters: normalizeDynamicParameters(effect, rawBackground.parameters)
          };
        })()
      : {
          type: "gradient",
          from: validColor(rawBackground.from, fallbackFrom),
          to: validColor(rawBackground.to, fallbackTo),
          angle: validNumber(rawBackground.angle, 0, 360, fallbackAngle)
        };

  const dynamicEffectProfiles: DynamicEffectProfiles = {};
  for (const [effectInput, rawProfile] of Object.entries(settingsRecord(settings.dynamicEffectProfiles))) {
    if (!isDynamicEffectInput(effectInput)) continue;
    const effect = normalizeDynamicEffect(effectInput);
    if (!isDynamicEffect(effectInput) && dynamicEffectProfiles[effect] !== undefined) continue;
    const profile = settingsRecord(rawProfile);
    dynamicEffectProfiles[effect] = {
      from: validColor(profile.from, fallbackFrom),
      to: validColor(profile.to, fallbackTo),
      angle: validNumber(profile.angle, 0, 360, fallbackAngle),
      speed: normalizeDynamicSpeed(effect, profile.speed),
      parameters: normalizeDynamicParameters(effect, profile.parameters)
    };
  }
  if (background.type === "dynamic") {
    dynamicEffectProfiles[background.effect] = {
      from: background.from,
      to: background.to,
      angle: background.angle,
      speed: background.speed,
      parameters: background.parameters
    };
  }
  const foreground = settingsRecord(settings.foreground);
  const layout = settingsRecord(settings.layout);
  const features = settingsRecord(settings.features);
  const bookmarkAlignment = layout.bookmarkAlignment;
  const hoverStyle = features.hoverStyle;
  const themeMode = features.themeMode;
  return {
    openTarget: settings.openTarget === "current-tab" || settings.openTarget === "new-tab"
      ? settings.openTarget
      : DEFAULT_SETTINGS.openTarget,
    background,
    dynamicEffectProfiles,
    foreground: {
      color: validColor(foreground.color, DEFAULT_SETTINGS.foreground.color),
      fontSize: validInteger(foreground.fontSize, 12, 24, DEFAULT_SETTINGS.foreground.fontSize)
    },
    layout: {
      rows: validInteger(layout.rows, 1, 10, DEFAULT_SETTINGS.layout.rows),
      columns: validInteger(layout.columns, 2, 10, DEFAULT_SETTINGS.layout.columns),
      bookmarkAlignment: bookmarkAlignment === "left" || bookmarkAlignment === "center" || bookmarkAlignment === "right"
        ? bookmarkAlignment
        : DEFAULT_SETTINGS.layout.bookmarkAlignment
    },
    clockPosition: validClockPosition(settings.clockPosition, DEFAULT_SETTINGS.clockPosition),
    features: {
      searchPosition: validClockPosition(features.searchPosition, DEFAULT_SETTINGS.features.searchPosition),
      searchIcon: typeof features.searchIcon === "boolean" ? features.searchIcon : DEFAULT_SETTINGS.features.searchIcon,
      searchText: validClockPosition(features.searchText, DEFAULT_SETTINGS.features.searchText),
      bookmarkDetails: typeof features.bookmarkDetails === "boolean"
        ? features.bookmarkDetails
        : DEFAULT_SETTINGS.features.bookmarkDetails,
      clockSeconds: typeof features.clockSeconds === "boolean" ? features.clockSeconds : DEFAULT_SETTINGS.features.clockSeconds,
      hoverStyle: hoverStyle === "underline" || hoverStyle === "box" || hoverStyle === "block"
        ? hoverStyle
        : DEFAULT_SETTINGS.features.hoverStyle,
      themeColor: validColor(features.themeColor, DEFAULT_SETTINGS.features.themeColor),
      themeMode: themeMode === "dark" || themeMode === "light" ? themeMode : DEFAULT_SETTINGS.features.themeMode
    }
  };
}

export function canonicalSettings(settings: SyncedSettings): SyncedSettings {
  return normalizeSettings(settings);
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
    settingsVersion: SETTINGS_VERSION,
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
    settingsVersion: SETTINGS_VERSION,
    updatedAt,
    config: settings,
    bookmarks,
    notes
  });
}

export function settingsFromSnapshot(snapshot: Snapshot): SyncedSettings {
  return canonicalSettings(snapshot.config);
}
