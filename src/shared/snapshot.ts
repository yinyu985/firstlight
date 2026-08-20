import {
  MAX_SNAPSHOT_BYTES,
  SETTINGS_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  type ClockPosition,
  canonicalSnapshot,
  normalizeSettings,
  type SyncNote,
  type BookmarkItem,
  type DynamicEffectProfiles,
  type Snapshot
} from "./model";
import {
  getDynamicEffectSpeed,
  isDynamicEffectInput,
  isDynamicEffect,
  normalizeDynamicEffect,
  normalizeDynamicParameters,
  normalizeDynamicSpeed
} from "./dynamicEffects";

const encoder = new TextEncoder();
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function semanticSnapshot(snapshot: Snapshot): Omit<Snapshot, "updatedAt"> {
  const { updatedAt: _updatedAt, ...semantic } = canonicalSnapshot(snapshot);
  return semantic;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function snapshotHash(snapshot: Snapshot): Promise<string> {
  return sha256(stableStringify(semanticSnapshot(snapshot)));
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(canonicalSnapshot(snapshot), null, 2);
}

export function snapshotBytes(snapshot: Snapshot): number {
  return encoder.encode(serializeSnapshot(snapshot)).byteLength;
}

export async function prettySnapshot(snapshot: Snapshot): Promise<string> {
  return serializeSnapshot(await projectSnapshotForDiff(snapshot));
}

export async function projectSnapshotForDiff(snapshot: Snapshot): Promise<Snapshot> {
  const project = async (nodes: BookmarkItem[]): Promise<BookmarkItem[]> => Promise.all(nodes.map(async (node) => {
    if (node.url === undefined) return { title: node.title, children: await project(node.children ?? []) };
    if (encoder.encode(node.url).byteLength <= 4096) return { title: node.title, url: node.url };
    const bytes = encoder.encode(node.url).byteLength;
    const protocolMatch = node.url.match(/^([a-z][a-z0-9+.-]*:)/i)?.[1];
    const protocol = protocolMatch ?? "unknown:";
    const contentStart = protocolMatch?.length ?? 0;
    const hash = await sha256(node.url);
    return {
      title: node.title,
      url: `${protocol}${node.url.slice(contentStart, contentStart + 256)}… [${bytes} bytes; SHA-256 ${hash}]`
    };
  }));
  return canonicalSnapshot({ ...snapshot, bookmarks: await project(snapshot.bookmarks) });
}

export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

export function validateNotes(value: unknown): SyncNote[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new SnapshotValidationError("Invalid notes list");
  const ids = new Set<string>();
  const supportedKeys = new Set(["id", "name", "content", "createtime", "updatetime"]);
  const isValidTimestamp = (raw: unknown): raw is string => (
    typeof raw === "string" && raw.endsWith("+08:00") && !Number.isNaN(Date.parse(raw))
  );
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new SnapshotValidationError(`Invalid note item at index ${index}`);
    }
    const note = item as Record<string, unknown>;
    if (Object.keys(note).some((key) => !supportedKeys.has(key))) {
      throw new SnapshotValidationError(`Note contains unsupported fields at index ${index}`);
    }
    if (typeof note.id !== "string" || note.id.length === 0) {
      throw new SnapshotValidationError(`Note id is invalid at index ${index}`);
    }
    if (ids.has(note.id)) throw new SnapshotValidationError(`Duplicate note id at index ${index}`);
    ids.add(note.id);
    if (typeof note.name !== "string") {
      throw new SnapshotValidationError(`Note name is invalid at index ${index}`);
    }
    if (typeof note.content !== "string") {
      throw new SnapshotValidationError(`Note content is invalid at index ${index}`);
    }
    if (!isValidTimestamp(note.createtime)) {
      throw new SnapshotValidationError(`Note createtime is invalid at index ${index}`);
    }
    if (!isValidTimestamp(note.updatetime)) {
      throw new SnapshotValidationError(`Note updatetime is invalid at index ${index}`);
    }
    return {
      id: note.id,
      name: note.name,
      content: note.content,
      createtime: note.createtime,
      updatetime: note.updatetime
    };
  });
}

export function validateSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SnapshotValidationError("The remote snapshot is not a JSON object");
  }
  const rawValue = input as Record<string, unknown>;
  if (rawValue.schemaVersion !== 1 && rawValue.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotValidationError("Unsupported snapshot version");
  }
  if (rawValue.settingsVersion !== undefined && (
    typeof rawValue.settingsVersion !== "number" || !Number.isInteger(rawValue.settingsVersion) || rawValue.settingsVersion < 0
  )) throw new SnapshotValidationError("Invalid settings version");
  if (typeof rawValue.settingsVersion === "number" && rawValue.settingsVersion > SETTINGS_VERSION) {
    throw new SnapshotValidationError("Settings were created by a newer Firstlight version");
  }
  const value: Record<string, unknown> = { ...rawValue, config: normalizeSettings(rawValue.config) };
  if (typeof value.updatedAt !== "string" || !value.updatedAt.endsWith("+08:00") || Number.isNaN(Date.parse(value.updatedAt))) {
    throw new SnapshotValidationError("Snapshot timestamp must use the +08:00 offset");
  }
  const config = value.config as unknown as Record<string, unknown> | undefined;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new SnapshotValidationError("Invalid snapshot config");
  }
  if (config.openTarget !== "new-tab" && config.openTarget !== "current-tab") {
    throw new SnapshotValidationError("Invalid bookmark open target");
  }
  const background = config.background as Record<string, unknown> | undefined;
  if (!background || (background.type !== "solid" && background.type !== "gradient" && background.type !== "dynamic")) {
    throw new SnapshotValidationError("Invalid background settings");
  }
  if (background.type === "solid" && (typeof background.color !== "string" || !HEX_COLOR.test(background.color))) {
    throw new SnapshotValidationError("Invalid solid background color");
  }
  if ((background.type === "gradient" || background.type === "dynamic") && (
    typeof background.from !== "string" || !HEX_COLOR.test(background.from) ||
    typeof background.to !== "string" || !HEX_COLOR.test(background.to)
  )) {
    throw new SnapshotValidationError("Invalid gradient settings");
  }
  if ((background.type === "gradient" || background.type === "dynamic") && (
    typeof background.angle !== "number" || !Number.isFinite(background.angle) ||
    background.angle < 0 || background.angle > 360
  )) throw new SnapshotValidationError("Invalid gradient settings");
  if (background.type === "dynamic") {
    if (background.effect !== undefined && !isDynamicEffectInput(background.effect)) {
      throw new SnapshotValidationError("Invalid dynamic background effect");
    }
    const effect = normalizeDynamicEffect(background.effect);
    const speedSpec = getDynamicEffectSpeed(effect);
    const speed = background.speed;
    if (typeof speed !== "number" || !Number.isFinite(speed)) throw new SnapshotValidationError("Invalid dynamic background speed");
    if ((speedSpec.integer && !Number.isInteger(speed)) || speed < speedSpec.min || speed > speedSpec.max) {
      throw new SnapshotValidationError("Invalid dynamic background speed");
    }
  }
  const parseDynamicEffectProfiles = (input: unknown): DynamicEffectProfiles => {
    if (input === undefined) return {};
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new SnapshotValidationError("Invalid dynamic effect profiles");
    }
    const profiles: DynamicEffectProfiles = {};
    for (const [effectInput, rawProfile] of Object.entries(input as Record<string, unknown>)) {
      if (!isDynamicEffectInput(effectInput)) throw new SnapshotValidationError("Invalid dynamic effect profile id");
      if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
        throw new SnapshotValidationError("Invalid dynamic effect profile");
      }
      const profile = rawProfile as Record<string, unknown>;
      if (typeof profile.from !== "string" || !HEX_COLOR.test(profile.from) ||
        typeof profile.to !== "string" || !HEX_COLOR.test(profile.to) ||
        typeof profile.angle !== "number" || !Number.isFinite(profile.angle) || profile.angle < 0 || profile.angle > 360) {
        throw new SnapshotValidationError("Invalid dynamic effect profile colors or angle");
      }
      const effect = normalizeDynamicEffect(effectInput);
      const isCanonical = isDynamicEffect(effectInput);
      if (!isCanonical && profiles[effect] !== undefined) continue;
      const speedSpec = getDynamicEffectSpeed(effect);
      if (typeof profile.speed !== "number" || !Number.isFinite(profile.speed) ||
        (speedSpec.integer && !Number.isInteger(profile.speed)) || profile.speed < speedSpec.min || profile.speed > speedSpec.max) {
        throw new SnapshotValidationError("Invalid dynamic effect profile speed");
      }
      profiles[effect] = {
        from: profile.from,
        to: profile.to,
        angle: profile.angle,
        speed: normalizeDynamicSpeed(effect, profile.speed),
        parameters: normalizeDynamicParameters(effect, profile.parameters)
      };
    }
    return profiles;
  };
  const dynamicEffectProfiles = parseDynamicEffectProfiles(config.dynamicEffectProfiles);
  const foreground = config.foreground as Record<string, unknown> | undefined;
  if (!foreground || (
    typeof foreground.color !== "string" || !HEX_COLOR.test(foreground.color) ||
    typeof foreground.fontSize !== "number" || !Number.isInteger(foreground.fontSize) ||
    foreground.fontSize < 12 || foreground.fontSize > 24
  )) {
    throw new SnapshotValidationError("Invalid foreground settings");
  }
  const layout = config.layout as Record<string, unknown> | undefined;
  const bookmarkAlignment = layout?.bookmarkAlignment ?? "center";
  if (!layout || (
    typeof layout.rows !== "number" || !Number.isInteger(layout.rows) || layout.rows < 1 || layout.rows > 10 ||
    typeof layout.columns !== "number" || !Number.isInteger(layout.columns) || layout.columns < 2 || layout.columns > 10 ||
    (bookmarkAlignment !== "left" && bookmarkAlignment !== "center" && bookmarkAlignment !== "right")
  )) {
    throw new SnapshotValidationError("Invalid home grid settings");
  }
  const clockPosition = config.clockPosition;
  if (clockPosition !== "hidden" && clockPosition !== "left" && clockPosition !== "center" && clockPosition !== "right") {
    throw new SnapshotValidationError("Clock position is invalid");
  }
  const features = config.features as Record<string, unknown> | undefined;
  const supportedFeatureKeys = new Set([
    "searchPosition",
    "searchIcon",
    "searchText",
    "bookmarkDetails",
    "clockSeconds",
    "hoverStyle",
    "themeColor",
    "themeMode"
  ]);
  if (features && Object.keys(features).some((key) => !supportedFeatureKeys.has(key))) {
    throw new SnapshotValidationError("Feature settings contain unsupported fields");
  }
  const searchPosition = features?.searchPosition;
  const searchIcon = features?.searchIcon;
  const searchText = features?.searchText;
  const normalizedSearchText = searchText === true
    ? "left"
    : searchText === false
      ? "hidden"
      : searchText;
  const isSearchTextPosition = (value: unknown): value is ClockPosition => (
    value === "hidden" || value === "left" || value === "center" || value === "right"
  );
  const bookmarkDetails = features?.bookmarkDetails;
  const clockSeconds = features?.clockSeconds;
  const hoverStyle = features?.hoverStyle === undefined ? "underline" : features.hoverStyle;
  const themeColor = features?.themeColor;
  const themeMode = features?.themeMode === undefined ? "dark" : features.themeMode;
  if (typeof themeColor !== "string" || !HEX_COLOR.test(themeColor)) {
    throw new SnapshotValidationError("Theme color is missing or invalid");
  }
  if ((searchPosition !== "hidden" && searchPosition !== "left" && searchPosition !== "center" && searchPosition !== "right") ||
    typeof searchIcon !== "boolean" ||
    !isSearchTextPosition(normalizedSearchText) ||
    typeof bookmarkDetails !== "boolean" || typeof clockSeconds !== "boolean" ||
    (hoverStyle !== "underline" && hoverStyle !== "box" && hoverStyle !== "block") ||
    (themeMode !== "dark" && themeMode !== "light")) {
    throw new SnapshotValidationError("Feature settings are invalid");
  }
  if (!Array.isArray(value.bookmarks)) throw new SnapshotValidationError("Invalid bookmark tree");

  let folders = 0;
  let bookmarks = 0;
  const validateNodes = (nodes: unknown[], depth: number): BookmarkItem[] => {
    if (depth > 64) throw new SnapshotValidationError("Bookmark nesting exceeds 64 levels");
    return nodes.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SnapshotValidationError("Invalid bookmark node");
      const node = raw as Record<string, unknown>;
      if (typeof node.title !== "string" || encoder.encode(node.title).byteLength > 65_536) {
        throw new SnapshotValidationError("Bookmark title is invalid or too long");
      }
      const hasUrl = typeof node.url === "string";
      const hasChildren = Array.isArray(node.children);
      if (hasUrl === hasChildren) throw new SnapshotValidationError("A bookmark node must be a link or a folder");
      if (hasUrl) {
        bookmarks += 1;
        if (bookmarks > 100_000) throw new SnapshotValidationError("Bookmark count exceeds 100000");
        if (encoder.encode(node.url as string).byteLength > MAX_SNAPSHOT_BYTES) {
          throw new SnapshotValidationError("A bookmark URL exceeds the platform transfer limit");
        }
        return { title: node.title, url: node.url as string };
      }
      folders += 1;
      if (folders > 100_000) throw new SnapshotValidationError("Folder count exceeds 100000");
      return { title: node.title, children: validateNodes(node.children as unknown[], depth + 1) };
    });
  };

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    settingsVersion: SETTINGS_VERSION,
    updatedAt: value.updatedAt,
    config: {
      openTarget: config.openTarget,
      background: background.type === "solid"
        ? { type: "solid" as const, color: background.color as string }
        : background.type === "gradient" ? {
            type: "gradient" as const,
            from: background.from as string,
            to: background.to as string,
            angle: background.angle as number
          } : {
            type: "dynamic" as const,
            effect: normalizeDynamicEffect(background.effect),
            from: background.from as string,
            to: background.to as string,
            angle: background.angle as number,
            speed: normalizeDynamicSpeed(normalizeDynamicEffect(background.effect), background.speed as number),
            parameters: normalizeDynamicParameters(
              normalizeDynamicEffect(background.effect),
              background.parameters
            )
          },
      dynamicEffectProfiles,
      foreground: { color: foreground.color as string, fontSize: foreground.fontSize as number },
      layout: { rows: layout.rows as number, columns: layout.columns as number, bookmarkAlignment },
      clockPosition,
      features: {
        searchPosition,
        searchIcon,
        searchText: normalizedSearchText,
        bookmarkDetails,
        clockSeconds,
        hoverStyle,
        themeColor,
        themeMode
      }
    },
    bookmarks: validateNodes(value.bookmarks, 0),
    notes: validateNotes(value.notes)
  } satisfies Snapshot;

  if (snapshotBytes(snapshot) > MAX_SNAPSHOT_BYTES) {
    throw new SnapshotValidationError("firstlight.json exceeds the 10 MiB GitHub Gist limit");
  }
  return canonicalSnapshot(snapshot);
}

export function parseSnapshot(text: string): Snapshot {
  if (encoder.encode(text).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new SnapshotValidationError("firstlight.json exceeds the 10 MiB GitHub Gist limit");
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SnapshotValidationError("firstlight.json is not valid JSON");
  }
  return validateSnapshot(input);
}
