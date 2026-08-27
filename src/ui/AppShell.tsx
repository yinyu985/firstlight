import type { DynamicEffect } from "../shared/dynamicEffects";
import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { ChevronDown, ChevronRight, Notebook, Search, Settings } from "lucide-react";
import type { Background, BookmarkAlignment, BookmarkItem, ClockPosition, DynamicBackground as DynamicBackgroundSettings, DynamicEffectProfile, DynamicEffectProfiles, SyncedSettings, SyncNote } from "../shared/model";
import {
  type ColorParameterDefinition,
  type DynamicEffectParameterDefinition,
  type DynamicEffectParameters,
  type RangeParameterDefinition,
  getDynamicEffectDefinition,
  DYNAMIC_EFFECT_DEFINITIONS,
  GALAXY_DEFAULT_COLORS,
  LIGHT_PILLAR_DEFAULT_COLORS,
  NEURO_NOISE_DEFAULT_COLORS,
  SNOW_DEFAULT_COLORS,
  SILK_DEFAULT_COLORS,
  type SelectParameterDefinition,
  type ToggleParameterDefinition,
  normalizeDynamicParameters,
  normalizeDynamicSpeed
} from "../shared/dynamicEffects";
import type { AppState } from "../shared/protocol";
import { canOpenBookmark } from "../shared/url";
import { searchBookmarks } from "./bookmarks";
import { DynamicBackground } from "./DynamicBackground";
import { deriveFolderTheme, type FolderTheme } from "./theme";
import { useClock } from "./useClock";
import { NotesApp, type NotesAppHandle } from "./notes/NotesApp";

const DiffView = lazy(() => import("./DiffView"));
const preloadDiffView = () => {
  void import("./DiffView");
};

interface Props {
  state: AppState;
  busy?: boolean;
  error?: string;
  openSetupOnLaunch?: boolean;
  onOpenBookmark: (url: string) => void;
  onSaveSettings?: (settings: SyncedSettings) => void;
  onSaveToken?: (token: string) => void;
  onUpload?: () => void;
  onImportBookmarks?: () => void;
  onCompareRemote?: () => void;
  onUseLocal?: (diffId: string) => void | Promise<void>;
  onUseRemote?: (diffId: string) => void | Promise<void>;
  onCloseDiff?: (diffId: string) => void;
  onOpenBookmarkManager?: () => void;
  onSaveNotes?: (notes: SyncNote[]) => void | Promise<void>;
}

type ColorControlDynamicBackground = Exclude<DynamicBackgroundSettings, { effect: "neuroNoise" }> & {
  effect: Exclude<DynamicEffect, "neuroNoise" | "flash">;
};

const GRID_COLUMN_WIDTH = 210;
const GRID_COLUMN_MIN_WIDTH = 170;
const GRID_COLUMN_GAP = 1;
const GRID_COLUMN_COMPACT_GAP = 1;

interface GridFit {
  columns: number;
  columnWidth: number;
  gap: number;
}

function fitGrid(columns: number, viewportWidth: number): GridFit {
  const available = viewportWidth * 0.8;
  const naturalWidth = columns * GRID_COLUMN_WIDTH + (columns - 1) * GRID_COLUMN_GAP;
  if (naturalWidth <= available) return { columns, columnWidth: GRID_COLUMN_WIDTH, gap: GRID_COLUMN_GAP };

  const elasticWidth = (available - (columns - 1) * GRID_COLUMN_COMPACT_GAP) / columns;
  if (elasticWidth >= GRID_COLUMN_MIN_WIDTH) {
    return { columns, columnWidth: Math.min(GRID_COLUMN_WIDTH, elasticWidth), gap: GRID_COLUMN_COMPACT_GAP };
  }

  const fittedColumns = Math.max(1, Math.floor((available + GRID_COLUMN_COMPACT_GAP) / (GRID_COLUMN_MIN_WIDTH + GRID_COLUMN_COMPACT_GAP)));
  const fittedWidth = (available - (fittedColumns - 1) * GRID_COLUMN_COMPACT_GAP) / fittedColumns;
  return {
    columns: Math.min(columns, fittedColumns),
    columnWidth: Math.min(GRID_COLUMN_WIDTH, fittedWidth),
    gap: GRID_COLUMN_COMPACT_GAP
  };
}

export function backgroundImageCss(background: Background): string {
  if (background.type === "solid") return "none";
  if (background.type === "dynamic" && (background.effect === "neuroNoise" || background.effect === "lightPillar" || background.effect === "snow" || background.effect === "silk" || background.effect === "flash")) return "none";
  return `linear-gradient(${background.angle}deg in oklab, ${background.from}, ${background.to})`;
}

export function backgroundColorCss(background: Background): string {
  if (background.type === "solid") return background.color;
  if (background.type === "dynamic" && background.effect === "neuroNoise") return "#070b12";
  if (background.type === "dynamic" && background.effect === "lightPillar") return "#000000";
  if (background.type === "dynamic" && background.effect === "snow") return SNOW_DEFAULT_COLORS.background;
  if (background.type === "dynamic" && background.effect === "silk") return background.from;
  if (background.type === "dynamic" && background.effect === "flash") return "#000000";
  return background.type === "dynamic"
    ? `color-mix(in oklab, ${background.from} 50%, ${background.to})`
    : background.from;
}

function countUrls(nodes: BookmarkItem[]): number {
  return nodes.reduce((total, node) => total + (node.url !== undefined ? 1 : countUrls(node.children ?? [])), 0);
}

function localThemeVariables(theme: FolderTheme): CSSProperties {
  return {
    "--folder-surface": theme.surface,
    "--folder-border": theme.border,
    "--folder-hover": theme.hover,
    "--folder-shadow": theme.shadow
  } as CSSProperties;
}

function useLocalPanelTheme(
  ref: RefObject<HTMLElement | null>,
  background: Background,
  foreground: string,
  active = true
): FolderTheme {
  const fallback = useMemo(
    () => deriveFolderTheme(background, foreground),
    [background, foreground]
  );
  const [theme, setTheme] = useState(fallback);

  useLayoutEffect(() => {
    setTheme(fallback);
    if (!active || !ref.current) return;
    const update = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const next = deriveFolderTheme(background, foreground, {
        x: Math.max(0, Math.min(window.innerWidth, rect.left + rect.width / 2)),
        y: Math.max(0, Math.min(window.innerHeight, rect.top + rect.height / 2)),
        width: window.innerWidth,
        height: window.innerHeight
      });
      setTheme((current) => (
        current.surface === next.surface && current.border === next.border && current.hover === next.hover && current.shadow === next.shadow
          ? current
          : next
      ));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ref.current);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [active, background, fallback, foreground, ref]);

  return theme;
}

interface FolderListProps {
  nodes: BookmarkItem[];
  onOpen: (item: BookmarkItem) => void;
  showDetails: boolean;
}

function FolderList({ nodes, onOpen, showDetails }: FolderListProps) {
  const [expanded, setExpanded] = useState<Set<BookmarkItem>>(() => new Set());
  if (!nodes.length) return <div className="folder-empty">EMPTY</div>;
  return <div className="folder-list">
    {nodes.map((item, index) => {
      const isFolder = item.children !== undefined;
      const isExpanded = expanded.has(item);
      return <div
        className={`folder-entry ${isExpanded ? "is-expanded" : ""}`}
        key={`${item.title}-${index}`}
      >
        <button
          className={`folder-row ${isFolder ? "is-folder" : ""}`}
          disabled={!isFolder && item.url !== undefined && !canOpenBookmark(item.url)}
          aria-expanded={isFolder ? isExpanded : undefined}
          onClick={() => {
            if (isFolder) {
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(item)) next.delete(item); else next.add(item);
                return next;
              });
            } else onOpen(item);
          }}
        >
          <span className="folder-row-content">
            {isFolder && <span className="row-mark" aria-hidden="true">{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>}
            <span className="row-title">{item.title || "UNTITLED"}</span>
            {isFolder && showDetails && <span className="row-count">{countUrls(item.children ?? [])}</span>}
          </span>
        </button>
        {isFolder && isExpanded && <FolderList nodes={item.children ?? []} onOpen={onOpen} showDetails={showDetails} />}
      </div>;
    })}
  </div>;
}

const FOLDER_SCROLLBAR_INSET = 2;
const FOLDER_SCROLLBAR_MAX_LENGTH = 20;

interface FolderScrollbarState {
  visible: boolean;
  offset: number;
  length: number;
}

function folderScrollbarState(element: HTMLDivElement): FolderScrollbarState {
  const scrollRange = element.scrollHeight - element.clientHeight;
  const trackLength = Math.max(0, element.clientHeight - FOLDER_SCROLLBAR_INSET * 2);
  const length = Math.min(FOLDER_SCROLLBAR_MAX_LENGTH, trackLength);
  const travel = Math.max(0, trackLength - length);
  return {
    visible: scrollRange > 1 && length > 0,
    offset: scrollRange > 0 ? (element.scrollTop / scrollRange) * travel : 0,
    length
  };
}

function FolderPopover({ nodes, onOpen, background, foreground, showDetails }: { nodes: BookmarkItem[]; onOpen: (item: BookmarkItem) => void; background: Background; foreground: string; showDetails: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollbarDragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);
  const [maxHeight, setMaxHeight] = useState(240);
  const [scrollbar, setScrollbar] = useState<FolderScrollbarState>({ visible: false, offset: 0, length: FOLDER_SCROLLBAR_MAX_LENGTH });
  const theme = useLocalPanelTheme(ref, background, foreground);
  useLayoutEffect(() => {
    const fit = () => {
      if (!ref.current) return;
      const top = ref.current.getBoundingClientRect().top;
      setMaxHeight(Math.max(72, window.innerHeight - top - 14));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useLayoutEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    const update = () => setScrollbar(folderScrollbarState(scrollArea));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollArea);
    if (scrollArea.firstElementChild) observer.observe(scrollArea.firstElementChild);
    return () => observer.disconnect();
  }, [maxHeight, nodes]);

  const dragScrollbar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = scrollbarDragRef.current;
    const scrollArea = scrollRef.current;
    if (!drag || !scrollArea || drag.pointerId !== event.pointerId) return;
    const scrollRange = scrollArea.scrollHeight - scrollArea.clientHeight;
    const trackLength = Math.max(0, scrollArea.clientHeight - FOLDER_SCROLLBAR_INSET * 2);
    const travel = trackLength - scrollbar.length;
    if (travel > 0) scrollArea.scrollTop = drag.startScrollTop + ((event.clientY - drag.startY) / travel) * scrollRange;
  };

  return <div className="folder-popover" ref={ref} style={{ maxHeight, ...localThemeVariables(theme) }}>
    <div
      className="folder-scroll-area"
      ref={scrollRef}
      onScroll={(event) => setScrollbar(folderScrollbarState(event.currentTarget))}
    >
      <div className="folder-scroll-content">
        <FolderList nodes={nodes} onOpen={onOpen} showDetails={showDetails} />
      </div>
    </div>
    {scrollbar.visible && <div className="folder-scrollbar" aria-hidden="true">
      <div
        className="folder-scrollbar-thumb"
        style={{ height: scrollbar.length, transform: `translateY(${scrollbar.offset}px)` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          scrollbarDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: scrollRef.current?.scrollTop ?? 0 };
        }}
        onPointerMove={dragScrollbar}
        onPointerUp={(event) => {
          if (scrollbarDragRef.current?.pointerId === event.pointerId) scrollbarDragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { scrollbarDragRef.current = null; }}
      />
    </div>}
  </div>;
}

interface OptionPickerProps {
  value: number;
  options: number[];
  suffix: string;
  label: string;
  onChange: (value: number) => void;
}

function useDismissablePicker(open: boolean, setOpen: (open: boolean) => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, setOpen]);
  return ref;
}

function OptionPicker({ value, options, suffix, label, onChange }: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  const menuId = useId();
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}><span>{value} {suffix}</span><b className="picker-arrow" aria-hidden="true" /></button>
    {open && <div className="picker-menu" id={menuId} role="listbox" aria-label={label}>{options.map((option) => <button key={option} role="option" aria-selected={option === value} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option}</button>)}</div>}
  </div>;
}

function ClockPicker({ value, label, onChange }: { value: ClockPosition; label: string; onChange: (value: ClockPosition) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  const menuId = useId();
  const options: ClockPosition[] = ["hidden", "left", "center", "right"];
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}><span>{value.toUpperCase()}</span><b className="picker-arrow" aria-hidden="true" /></button>
    {open && <div className="picker-menu clock-menu" id={menuId} role="listbox" aria-label={label}>{options.map((option) => <button key={option} role="option" aria-selected={option === value} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option.toUpperCase()}</button>)}</div>}
  </div>;
}

function DynamicEffectPicker({ value, onChange }: { value: DynamicEffect; onChange: (value: DynamicEffect) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  const menuId = useId();
  const effects = DYNAMIC_EFFECT_DEFINITIONS;
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" aria-label="动态背景动效" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}><span>{effects.find((effect) => effect.id === value)?.label ?? "SELECT"}</span><b className="picker-arrow" aria-hidden="true" /></button>
    {open && <div className="picker-menu effect-menu" id={menuId} role="listbox" aria-label="动态背景动效">{effects.map((effect) => {
      return <button
        key={effect.id}
        role="option"
        aria-selected={effect.id === value}
        className={effect.id === value ? "selected" : ""}
        disabled={!effect.implemented}
        onClick={() => {
          if (!effect.implemented) return;
          onChange(effect.id);
          setOpen(false);
        }}
      >
        {effect.label}
      </button>;
    })}</div>}
  </div>;
}

function dynamicColorHint(effect: DynamicEffect): string {
  switch (effect) {
    case "dotGrid":
      return "左侧是圆点常态颜色，右侧是鼠标靠近时的发光颜色";
    case "lightPillar":
      return "左侧是光柱顶部颜色，右侧是光柱底部颜色";
    case "galaxy":
      return "透明背景开启时，这两种颜色显示在星河下方";
    default:
      return "控制动画混合使用的两种主色";
  }
}

export function dynamicBackgroundHasColorControls(background: DynamicBackgroundSettings): background is ColorControlDynamicBackground {
  return background.effect !== "neuroNoise" && background.effect !== "flash";
}

const DYNAMIC_EFFECT_PARAMETER_LABELS = {
  range: "range",
  color: "color",
  toggle: "toggle",
  select: "select"
} as const;

function DynamicEffectRangeField({ value, spec, onChange }: { value: number; spec: RangeParameterDefinition; onChange: (value: number) => void }) {
  const numericValue = Number.isFinite(value) ? value : spec.defaultValue;
  const safeValue = spec.integer ? Math.round(numericValue) : numericValue;

  return <div className="setting-line size-line">
    <label><span className="parameter-copy"><span>{spec.label}</span>{spec.hint && <small>{spec.hint}</small>}</span><b>{spec.integer ? Math.round(safeValue) : safeValue.toFixed(2)}</b></label>
    <input
      type="range"
      aria-label={spec.label}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={safeValue}
      onChange={(event) => onChange(Number.parseFloat(event.target.value))}
    />
  </div>;
}

function DynamicEffectColorField({ value, spec, onChange }: { value: string; spec: ColorParameterDefinition; onChange: (value: string) => void }) {
  return <div className="setting-line"><label className="parameter-copy"><span>{spec.label}</span>{spec.hint && <small>{spec.hint}</small>}</label><input aria-label={spec.label} className="color-input" type="color" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function DynamicEffectToggleField({ value, spec, onChange }: { value: boolean; spec: ToggleParameterDefinition; onChange: (value: boolean) => void }) {
  return <div className="setting-line"><label className="parameter-copy"><span>{spec.label}</span>{spec.hint && <small>{spec.hint}</small>}</label><div className="segmented visibility-toggle" role="group" aria-label={spec.label}><button aria-pressed={value} className={value ? "selected" : ""} onClick={() => onChange(true)}>开</button><button aria-pressed={!value} className={!value ? "selected" : ""} onClick={() => onChange(false)}>关</button></div></div>;
}

function DynamicEffectSelectField({ value, spec, onChange }: { value: string; spec: SelectParameterDefinition; onChange: (value: string) => void }) {
  return <div className="setting-line"><label className="parameter-copy"><span>{spec.label}</span>{spec.hint && <small>{spec.hint}</small>}</label><div className="segmented" role="group" aria-label={spec.label}>{spec.options.map((option) => <button key={option.value} aria-pressed={option.value === value} className={option.value === value ? "selected" : ""} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>;
}

function DynamicEffectParameterRows({ definitions, values, onChange }: {
  definitions: readonly DynamicEffectParameterDefinition[];
  values: DynamicEffectParameters;
  onChange: (next: DynamicEffectParameters) => void;
}) {
  const validateColor = (definition: ColorParameterDefinition) => {
    const value = values[definition.key];
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : definition.defaultValue;
  };
  const validateBoolean = (definition: ToggleParameterDefinition) => {
    const value = values[definition.key];
    return typeof value === "boolean" ? value : definition.defaultValue;
  };
  const validateRange = (definition: RangeParameterDefinition) => {
    const value = values[definition.key];
    const numericValue = typeof value === "number" && Number.isFinite(value) ? value : definition.defaultValue;
    return Math.max(definition.min, Math.min(definition.max, definition.integer ? Math.round(numericValue) : numericValue));
  };
  const validateSelection = (definition: SelectParameterDefinition) => {
    const value = values[definition.key];
    const candidates = new Set(definition.options.map((option) => option.value));
    return typeof value === "string" && candidates.has(value) ? value : definition.defaultValue;
  };

  return <>
    {definitions.map((definition) => {
      if (definition.hidden) return null;
      switch (definition.kind) {
        case DYNAMIC_EFFECT_PARAMETER_LABELS.range: {
          const spec = definition as RangeParameterDefinition;
          const rangeValue = validateRange(spec);
          return <DynamicEffectRangeField
            key={definition.key}
            value={rangeValue}
            spec={spec}
            onChange={(value) => onChange({ ...values, [definition.key]: value })}
          />;
        }
        case DYNAMIC_EFFECT_PARAMETER_LABELS.color:
        {
          const colorSpec = definition as ColorParameterDefinition;
          return <DynamicEffectColorField
            key={definition.key}
            value={validateColor(colorSpec)}
            spec={colorSpec}
            onChange={(value) => onChange({ ...values, [definition.key]: value })}
          />;
        }
        case DYNAMIC_EFFECT_PARAMETER_LABELS.toggle:
        {
          const toggleSpec = definition as ToggleParameterDefinition;
          return <DynamicEffectToggleField
            key={definition.key}
            value={validateBoolean(toggleSpec)}
            spec={toggleSpec}
            onChange={(value) => onChange({ ...values, [definition.key]: value })}
          />;
        }
        case DYNAMIC_EFFECT_PARAMETER_LABELS.select:
        {
          const selectSpec = definition as SelectParameterDefinition;
          return <DynamicEffectSelectField
            key={definition.key}
            value={validateSelection(selectSpec)}
            spec={selectSpec}
            onChange={(value) => onChange({ ...values, [definition.key]: value })}
          />;
        }
        default:
          return null;
      }
    })}
  </>;
}

function normalizeDynamicAngle(angle: number): number {
  const safe = Number.isFinite(angle) ? angle : 0;
  const wrapped = safe % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function normalizeDynamicBackground(background: DynamicBackgroundSettings): DynamicBackgroundSettings {
  if (background.effect === "neuroNoise") {
    return {
      type: "dynamic",
      effect: "neuroNoise",
      speed: normalizeDynamicSpeed("neuroNoise", background.speed),
      parameters: normalizeDynamicParameters("neuroNoise", background.parameters)
    };
  }
  return {
    ...background,
    angle: normalizeDynamicAngle(background.angle),
    speed: normalizeDynamicSpeed(background.effect, background.speed),
    parameters: normalizeDynamicParameters(background.effect, background.parameters)
  };
}

function profileFromDynamicBackground(background: DynamicBackgroundSettings): DynamicEffectProfile {
  const normalized = normalizeDynamicBackground(background);
  if (normalized.effect === "neuroNoise") {
    return {
      speed: normalized.speed,
      parameters: normalized.parameters
    };
  }
  return {
    from: normalized.from,
    to: normalized.to,
    angle: normalized.angle,
    speed: normalized.speed,
    parameters: normalized.parameters
  };
}

function storeDynamicProfile(profiles: DynamicEffectProfiles, background: DynamicBackgroundSettings): void {
  const profile = profileFromDynamicBackground(background);
  if (background.effect === "neuroNoise") {
    profiles.neuroNoise = profile as DynamicEffectProfile<"neuroNoise">;
  } else {
    profiles[background.effect] = profile as DynamicEffectProfile<typeof background.effect>;
  }
}

function genericColorSettings(background: Background): { from: string; to: string; angle: number } {
  if (background.type === "solid") return { from: background.color, to: "#13242a", angle: 145 };
  if (background.type === "gradient" || background.effect !== "neuroNoise") {
    return { from: background.from, to: background.to, angle: background.angle };
  }
  const colorBack = background.parameters?.colorBack;
  const colorMid = background.parameters?.colorMid;
  return {
    from: typeof colorBack === "string" ? colorBack : NEURO_NOISE_DEFAULT_COLORS.back,
    to: typeof colorMid === "string" ? colorMid : NEURO_NOISE_DEFAULT_COLORS.mid,
    angle: 145
  };
}

function baselineDynamicBackground(
  from: Background,
  effect: DynamicEffect,
  profiles: DynamicEffectProfiles = {}
): DynamicBackgroundSettings {
  const definition = getDynamicEffectDefinition(effect);
  if (from.type === "dynamic" && from.effect === effect) {
    return normalizeDynamicBackground(from);
  }
  if (effect === "neuroNoise") {
    const savedProfile = profiles.neuroNoise;
    if (savedProfile) {
      return {
        type: "dynamic",
        effect,
        speed: normalizeDynamicSpeed(effect, savedProfile.speed),
        parameters: normalizeDynamicParameters(effect, savedProfile.parameters)
      };
    }
    return {
      type: "dynamic",
      effect,
      speed: definition.speed.defaultValue,
      parameters: normalizeDynamicParameters(effect, definition.defaultParameters)
    };
  }
  const savedProfile = profiles[effect];
  if (savedProfile) {
    return {
      type: "dynamic",
      effect,
      from: savedProfile.from,
      to: savedProfile.to,
      angle: normalizeDynamicAngle(savedProfile.angle),
      speed: normalizeDynamicSpeed(effect, savedProfile.speed),
      parameters: normalizeDynamicParameters(effect, savedProfile.parameters)
    };
  }
  const source = genericColorSettings(from);
  const colors = effect === "lightPillar"
    ? { from: LIGHT_PILLAR_DEFAULT_COLORS.top, to: LIGHT_PILLAR_DEFAULT_COLORS.bottom }
    : effect === "galaxy"
      ? GALAXY_DEFAULT_COLORS
      : effect === "snow"
        ? { from: SNOW_DEFAULT_COLORS.snow, to: SNOW_DEFAULT_COLORS.background }
        : effect === "silk"
          ? { from: SILK_DEFAULT_COLORS.silk, to: SILK_DEFAULT_COLORS.silk }
          : effect === "flash"
            ? { from: "#000000", to: "#000000" }
            : source;

  return {
    type: "dynamic",
    effect,
    from: colors.from,
    to: colors.to,
    angle: normalizeDynamicAngle(source.angle),
    speed: definition.speed.defaultValue,
    parameters: normalizeDynamicParameters(effect, definition.defaultParameters)
  };
}

function SearchTextPicker({ value, onChange }: { value: ClockPosition; onChange: (value: ClockPosition) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  const menuId = useId();
  const options: ClockPosition[] = ["hidden", "left", "center", "right"];
  const label = value === "hidden" ? "HIDE" : value.toUpperCase();
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" aria-label="Search text position" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}><span>{label}</span><b className="picker-arrow" aria-hidden="true" /></button>
    {open && <div className="picker-menu clock-menu" id={menuId} role="listbox" aria-label="Search text position">{options.map((option) => <button key={option} role="option" aria-selected={option === value} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option === "hidden" ? "HIDE" : option.toUpperCase()}</button>)}</div>}
  </div>;
}

function AlignmentPicker({ value, onChange }: { value: BookmarkAlignment; onChange: (value: BookmarkAlignment) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  const menuId = useId();
  const options: BookmarkAlignment[] = ["left", "center", "right"];
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" aria-label="Bookmark alignment" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}><span>{value.toUpperCase()}</span><b className="picker-arrow" aria-hidden="true" /></button>
    {open && <div className="picker-menu alignment-menu" id={menuId} role="listbox" aria-label="Bookmark alignment">{options.map((option) => <button key={option} role="option" aria-selected={option === value} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option.toUpperCase()}</button>)}</div>}
  </div>;
}

function VisibilityToggle({ visible, label, onChange }: { visible: boolean; label: string; onChange: (visible: boolean) => void }) {
  return <div className="segmented visibility-toggle" role="group" aria-label={label}><button aria-pressed={visible} className={visible ? "selected" : ""} onClick={() => onChange(true)}>SHOW</button><button aria-pressed={!visible} className={!visible ? "selected" : ""} onClick={() => onChange(false)}>HIDE</button></div>;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function trapTabKey(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute("hidden"));
  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function AppShell(props: Props) {
  const { state } = props;
  const clockVisible = state.settings.clockPosition !== "hidden";
  const clock = useClock(state.settings.features.clockSeconds, clockVisible);
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(props.openSetupOnLaunch));
  const [openFolder, setOpenFolder] = useState<BookmarkItem | null>(null);
  const [token, setToken] = useState(state.token ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [notesResetKey, setNotesResetKey] = useState(0);
  const [visibleToast, setVisibleToast] = useState(() => state.toast && state.toast.expiresAt > Date.now() ? state.toast : undefined);
  const [dismissedDiffKey, setDismissedDiffKey] = useState<string>();
  const [showSyncNotice, setShowSyncNotice] = useState(false);
  const [gridFit, setGridFit] = useState(() => fitGrid(state.settings.layout.columns, window.innerWidth));
  const gridRef = useRef<HTMLDivElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const syncToastRef = useRef<HTMLDivElement>(null);
  const notesAppRef = useRef<NotesAppHandle>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsDrawerRef = useRef<HTMLElement>(null);
  const [contentBounds, setContentBounds] = useState<{ left: number; width: number }>();
  const results = useMemo(() => searchBookmarks(state.bookmarks, query), [state.bookmarks, query]);
  const readonly = state.target === "online";
  const searchPosition = state.settings.features.searchPosition;
  const folderTheme = useMemo(
    () => deriveFolderTheme(state.settings.background, state.settings.foreground.color),
    [state.settings.background, state.settings.foreground.color]
  );
  const activeBackground = state.settings.background.type === "dynamic"
    ? normalizeDynamicBackground(state.settings.background)
    : state.settings.background;
  const remoteOperationActive = state.tokenConfigured && (
    state.sync.phase === "uploading" || state.sync.phase === "discovering" || state.sync.phase === "restoring"
  );
  const notificationMessage = showSyncNotice ? state.sync.message : visibleToast?.message;
  const hasNotification = Boolean(notificationMessage);
  const diffKey = state.diff?.id;
  const visibleDiff = state.diff && diffKey !== dismissedDiffKey ? state.diff : undefined;
  const busy = Boolean(props.busy);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);
  const searchResultsTheme = useLocalPanelTheme(
    searchResultsRef,
    state.settings.background,
    state.settings.foreground.color,
    searchPosition !== "hidden" && Boolean(query) && searchResultsOpen
  );
  const syncToastTheme = useLocalPanelTheme(
    syncToastRef,
    state.settings.background,
    state.settings.foreground.color,
    hasNotification
  );
  useEffect(() => {
    if (props.openSetupOnLaunch) setSettingsOpen(true);
  }, [props.openSetupOnLaunch]);

  useEffect(() => {
    if (!settingsOpen) return;
    const frame = window.requestAnimationFrame(() => settingsDrawerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [settingsOpen]);

  useEffect(() => {
    if (!remoteOperationActive) {
      setShowSyncNotice(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowSyncNotice(true);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [remoteOperationActive]);

  useEffect(() => {
    if (!settingsOpen || readonly) return;
    preloadDiffView();
  }, [readonly, settingsOpen]);

  useEffect(() => {
    setOpenFolder(null);
  }, [state.settings.layout.rows, state.settings.layout.columns]);

  useEffect(() => {
    setOpenFolder((current) => current && state.bookmarks.includes(current) ? current : null);
  }, [state.bookmarks]);

  useLayoutEffect(() => {
    const fit = () => {
      const next = fitGrid(state.settings.layout.columns, window.innerWidth);
      setGridFit((current) => (
        current.columns === next.columns && current.columnWidth === next.columnWidth && current.gap === next.gap ? current : next
      ));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [state.settings.layout.columns]);

  useEffect(() => {
    setToken(state.token ?? "");
  }, [state.token]);

  useEffect(() => {
    if (!state.diff) setDismissedDiffKey(undefined);
  }, [state.diff]);

  useEffect(() => {
    if (state.diff && state.sync.phase === "error") setDismissedDiffKey(undefined);
  }, [state.diff, state.sync.phase]);

  useEffect(() => {
    const notice = state.toast;
    if (!notice || notice.expiresAt <= Date.now()) {
      setVisibleToast(undefined);
      return;
    }
    setVisibleToast(notice);
    const timer = window.setTimeout(() => {
      setVisibleToast((current) => current?.id === notice.id ? undefined : current);
    }, Math.max(0, notice.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state.toast?.id, state.toast?.expiresAt]);

  useEffect(() => {
  const closeDetachedLists = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".search-shell, .search-results")) setSearchResultsOpen(false);
      if (!target.closest(".bookmark-cell-wrap.active")) setOpenFolder(null);
      if (!target.closest(".status-dock") && !target.closest(".notes-window")) setNoteOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchResultsOpen(false);
      setOpenFolder(null);
      setNoteOpen(false);
      if (settingsOpen) closeSettings();
    };
    document.addEventListener("pointerdown", closeDetachedLists);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeDetachedLists);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeSettings, settingsOpen]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const stage = grid.closest<HTMLElement>(".center-stage");
      const contents = Array.from(grid.querySelectorAll<HTMLElement>(".cell-content"));
      if (!stage || !contents.length) {
        setContentBounds(undefined);
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      const rectangles = contents.map((content) => content.getBoundingClientRect());
      const left = Math.min(...rectangles.map((rect) => rect.left)) - stageRect.left;
      const right = Math.max(...rectangles.map((rect) => rect.right)) - stageRect.left;
      setContentBounds((current) => {
        const next = { left, width: Math.max(120, right - left) };
        return current && Math.abs(current.left - next.left) < 0.5 && Math.abs(current.width - next.width) < 0.5 ? current : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    for (const content of grid.querySelectorAll<HTMLElement>(".cell-content")) observer.observe(content);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [gridFit, searchResultsOpen, state.bookmarks, state.settings.foreground.fontSize, state.settings.layout.columns, state.settings.layout.rows]);

  const open = (item: BookmarkItem) => {
    if (item.url !== undefined && canOpenBookmark(item.url)) props.onOpenBookmark(item.url);
  };
  const updateSettings = (settings: SyncedSettings) => props.onSaveSettings?.(settings);
  const setBackground = (background: SyncedSettings["background"]) => {
    const dynamicEffectProfiles: DynamicEffectProfiles = { ...(state.settings.dynamicEffectProfiles ?? {}) };
    const nextBackground = background.type === "dynamic" ? normalizeDynamicBackground(background) : background;
    if (state.settings.background.type === "dynamic") {
      storeDynamicProfile(dynamicEffectProfiles, state.settings.background);
    }
    if (nextBackground.type === "dynamic") {
      storeDynamicProfile(dynamicEffectProfiles, nextBackground);
    }
    updateSettings({ ...state.settings, background: nextBackground, dynamicEffectProfiles });
  };
  const updateGradientBackground = (
    patch: Partial<Omit<Extract<Background, { type: "gradient" }>, "type">>
  ) => {
    const current = state.settings.background;
    if (current.type !== "gradient") return;
    setBackground({ ...current, ...patch });
  };

  const gridWidth = gridFit.columns * gridFit.columnWidth + (gridFit.columns - 1) * gridFit.gap;
  const modeColorSettings = genericColorSettings(state.settings.background);
  const contentFrameStyle = contentBounds ? { width: contentBounds.width, marginLeft: contentBounds.left } : undefined;
  const searchResultStyle = contentBounds ? {
    width: contentBounds.width / 2,
    marginLeft: contentBounds.left + (searchPosition === "center" ? contentBounds.width / 4 : searchPosition === "right" ? contentBounds.width / 2 : 0)
  } : undefined;

  return (
    <main className={`app theme-${state.settings.features.themeMode} bookmarks-${state.settings.layout.bookmarkAlignment} hover-${state.settings.features.hoverStyle} ${activeBackground.type === "dynamic" ? "background-dynamic" : ""}`} style={{
      backgroundColor: backgroundColorCss(activeBackground),
      backgroundImage: backgroundImageCss(activeBackground),
      color: state.settings.foreground.color,
      "--foreground-color": state.settings.foreground.color,
      "--bookmark-font-size": `${state.settings.foreground.fontSize}px`,
      "--ui-font-size": `${state.settings.foreground.fontSize}px`,
      "--theme-color": state.settings.features.themeColor,
      "--grid-columns": gridFit.columns,
      "--grid-rows": state.settings.layout.rows,
      "--grid-width": `${gridWidth}px`,
      "--grid-column-width": `${gridFit.columnWidth}px`,
      "--grid-column-gap": `${gridFit.gap}px`,
      "--folder-surface": folderTheme.surface,
      "--folder-border": folderTheme.border,
      "--folder-hover": folderTheme.hover,
      "--folder-shadow": folderTheme.shadow
    } as CSSProperties} onClick={() => setOpenFolder(null)}>
      {activeBackground.type === "dynamic" && !reducedMotion && <DynamicBackground background={activeBackground} />}
      <div className="scanlines" />

      <div
        ref={syncToastRef}
        className={`status-dock phase-${state.sync.phase} ${hasNotification ? "has-notification" : ""} ${noteOpen ? "is-open" : ""}`}
        style={localThemeVariables(syncToastTheme)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="note-trigger"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setNoteOpen((current) => !current);
          }}
          aria-expanded={noteOpen}
          aria-controls="notes-app"
          aria-label="Open note panel"
        >
          <Notebook className="note-icon" size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {hasNotification && <span className="sync-toast" role="status">{notificationMessage}</span>}
      </div>
      {noteOpen && <NotesApp
        ref={notesAppRef}
        initialNotes={state.notes}
        onSave={props.onSaveNotes}
        readonly={readonly}
        externalResetKey={notesResetKey}
      />}

      <section className="center-stage" onClick={(event) => event.stopPropagation()}>
        {state.settings.clockPosition !== "hidden" && <header className={`topline clock-${state.settings.clockPosition}`} style={contentFrameStyle}><time>{clock}</time></header>}

        {searchPosition !== "hidden" && <div className={`search-shell search-${searchPosition}`} style={contentFrameStyle}><label className={`search-box search-text-${state.settings.features.searchText}`}>
          {state.settings.features.searchIcon && <span className="search-prefix"><Search size={20} strokeWidth={1.8} /></span>}
          <input
            value={query}
            onFocus={() => { if (query) setSearchResultsOpen(true); }}
            onChange={(event) => { setQuery(event.target.value); setSearchResultsOpen(Boolean(event.target.value)); setOpenFolder(null); }}
            placeholder={state.settings.features.searchText === "hidden" ? "" : "SEARCH BOOKMARKS"}
            aria-label="Search bookmarks"
            autoComplete="off"
          />
          {query && <button onClick={() => { setQuery(""); setSearchResultsOpen(false); }} aria-label="Clear search">×</button>}
        </label></div>}

        {searchPosition !== "hidden" && query && searchResultsOpen ? <div ref={searchResultsRef} className={`search-results search-${searchPosition}`} style={{ ...searchResultStyle, ...localThemeVariables(searchResultsTheme) }}>
          {results.length ? <><div className="table-head"><span>PATH</span><span>NAME</span></div>{results.map((result, index) => (
            <button key={`${result.path}-${result.item.title}-${index}`} className="search-row" disabled={!canOpenBookmark(result.item.url)} onClick={() => open(result.item)}>
              <small>{result.path}</small><span>{result.item.title || result.item.url}</span>
            </button>
          ))}</> : <div className="empty">NO RESULTS</div>}
        </div> : <><div className="bookmark-table" ref={gridRef}>
          {state.bookmarks.length ? state.bookmarks.map((item, index) => {
            const folder = item.children !== undefined;
            const active = openFolder === item;
            return <div className={`bookmark-cell-wrap ${active ? "active" : ""}`} key={`${item.title}-${index}`}>
              <button
                className="bookmark-cell"
                disabled={!folder && item.url !== undefined && !canOpenBookmark(item.url)}
                aria-expanded={folder ? active : undefined}
                onClick={() => folder ? setOpenFolder(active ? null : item) : open(item)}
              >
                <span className="cell-content">
                  <span className="cell-name">{item.title || "UNTITLED"}</span>
                  {state.settings.features.bookmarkDetails && <span className={`cell-kind ${folder ? "cell-count" : "cell-link"}`}>{folder ? countUrls(item.children ?? []) : "↗"}</span>}
                </span>
              </button>
              {folder && active && <FolderPopover nodes={item.children ?? []} onOpen={open} background={state.settings.background} foreground={state.settings.foreground.color} showDetails={state.settings.features.bookmarkDetails} />}
            </div>;
          }) : <div className="empty table-empty">BOOKMARK BAR IS EMPTY</div>}
        </div></>}
      </section>

      <button ref={settingsTriggerRef} className="settings-trigger" onClick={(event) => { event.stopPropagation(); setSettingsOpen(true); }} aria-label="Open settings" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="settings-drawer"><Settings size={20} strokeWidth={1.8} /></button>

      {settingsOpen && <><div className="drawer-backdrop" aria-hidden="true" onClick={closeSettings} />
      <aside id="settings-drawer" ref={settingsDrawerRef} className="settings-drawer open" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onKeyDown={trapTabKey} onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header"><span id="settings-title" className="brand-lockup"><img src="./firstlight-mark.png" alt="" />FIRSTLIGHT</span></header>
        <div className="drawer-content">
          <section className="settings-section">
            <div className="section-title"><span>BOOKMARKS</span>{!readonly && <button disabled={busy} onClick={props.onOpenBookmarkManager}>OPEN MANAGER ↗</button>}</div>
            <div className="setting-line"><label>Open target</label><div className="segmented" role="group" aria-label="Open target"><button aria-pressed={state.settings.openTarget === "new-tab"} className={state.settings.openTarget === "new-tab" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, openTarget: "new-tab" })}>NEW TAB</button><button aria-pressed={state.settings.openTarget === "current-tab"} className={state.settings.openTarget === "current-tab" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, openTarget: "current-tab" })}>CURRENT</button></div></div>
            {!readonly && <div className="setting-line"><label>Chrome import</label><button aria-label="Import Chrome bookmarks" className="inline-action" disabled={busy} onClick={props.onImportBookmarks}>IMPORT</button></div>}
          </section>

          <section className="settings-section">
            <div className="section-title"><span>BACKGROUND</span></div>
            <div className="setting-line"><label>Mode</label><div className="segmented" role="group" aria-label="Background mode"><button aria-pressed={state.settings.background.type === "solid"} className={state.settings.background.type === "solid" ? "selected" : ""} onClick={() => setBackground({ type: "solid", color: modeColorSettings.from })}>SOLID</button><button aria-pressed={state.settings.background.type === "gradient"} className={state.settings.background.type === "gradient" ? "selected" : ""} onClick={() => setBackground({ type: "gradient", ...modeColorSettings })}>GRADIENT</button><button aria-pressed={state.settings.background.type === "dynamic"} className={state.settings.background.type === "dynamic" ? "selected" : ""} onClick={() => setBackground(baselineDynamicBackground(state.settings.background, state.settings.background.type === "dynamic" ? state.settings.background.effect : "flow", state.settings.dynamicEffectProfiles))}>DYNAMIC</button></div></div>
            {state.settings.background.type === "solid" ? (
              <div className="setting-line"><label>Color</label><input aria-label="Background color" className="color-input" type="color" value={state.settings.background.color} onChange={(event) => setBackground({ type: "solid", color: event.target.value })} /></div>
            ) : activeBackground.type === "dynamic" ? (
              (() => {
                const dynamicBackground = activeBackground;
                const effectDefinition = getDynamicEffectDefinition(dynamicBackground.effect);
                const parameters = normalizeDynamicParameters(dynamicBackground.effect, dynamicBackground.parameters);
                const speedLabel = effectDefinition.speed.label ?? "动画速度";
                return <>
                  <div className="setting-line"><label>动效</label><DynamicEffectPicker
                    value={dynamicBackground.effect}
                    onChange={(effect) => setBackground(baselineDynamicBackground(dynamicBackground, effect, state.settings.dynamicEffectProfiles))}
                  /></div>
                  {dynamicBackground.effect === "snow" || dynamicBackground.effect === "silk" ? <div className="setting-line"><label className="parameter-copy"><span>{dynamicBackground.effect === "snow" ? "雪花颜色" : "流光颜色"}</span><small>{dynamicBackground.effect === "snow" ? "控制所有雪花使用的颜色" : "控制整片丝绸流光使用的主色"}</small></label><input aria-label={dynamicBackground.effect === "snow" ? "雪花颜色" : "流光颜色"} className="color-input" type="color" value={dynamicBackground.from} onChange={(event) => setBackground({ ...dynamicBackground, from: event.target.value, to: dynamicBackground.effect === "silk" ? event.target.value : dynamicBackground.to })} /></div> : dynamicBackgroundHasColorControls(dynamicBackground) && <div className="setting-line"><label className="parameter-copy"><span>动效颜色</span><small>{dynamicColorHint(dynamicBackground.effect)}</small></label><div className="color-pair" role="group" aria-label="动效颜色"><input aria-label="第一种动效颜色" type="color" value={dynamicBackground.from} onChange={(event) => setBackground({ ...dynamicBackground, from: event.target.value })} /><input aria-label="第二种动效颜色" type="color" value={dynamicBackground.to} onChange={(event) => setBackground({ ...dynamicBackground, to: event.target.value })} /></div></div>}
                  {dynamicBackground.effect !== "neuroNoise" && effectDefinition.supportsAngle && <div className="setting-line angle-line size-line"><label><span className="parameter-copy"><span>流动方向</span><small>旋转整个颜色场的运动方向</small></span><b>{dynamicBackground.angle}°</b></label><input aria-label="动效流动方向" type="range" min="0" max="360" value={dynamicBackground.angle} onChange={(event) => setBackground({ ...dynamicBackground, angle: Number(event.target.value) })} /></div>}
                  <div className="setting-line size-line speed-line">
                    <label><span className="parameter-copy"><span>{speedLabel}</span>{effectDefinition.speed.hint && <small>{effectDefinition.speed.hint}</small>}</span><b>{dynamicBackground.speed}</b></label>
                    <input
                      type="range"
                      aria-label={speedLabel}
                      min={effectDefinition.speed.min}
                      max={effectDefinition.speed.max}
                      step={effectDefinition.speed.step}
                      value={dynamicBackground.speed}
                      onChange={(event) => setBackground({ ...dynamicBackground, speed: Number(event.target.value) })}
                    />
                  </div>
                  <DynamicEffectParameterRows
                    definitions={effectDefinition.parameters}
                    values={parameters}
                    onChange={(nextParameters) => setBackground({ ...dynamicBackground, parameters: nextParameters })}
                  />
                </>;
              })()
            ) : (
              <div>
                <div className="setting-line"><label>Colors</label><div className="color-pair" role="group" aria-label="Gradient colors"><input aria-label="Gradient start color" type="color" value={modeColorSettings.from} onChange={(event) => updateGradientBackground({ from: event.target.value })} /><input aria-label="Gradient end color" type="color" value={modeColorSettings.to} onChange={(event) => updateGradientBackground({ to: event.target.value })} /></div></div>
                <div className="setting-line angle-line"><label>Angle <b>{modeColorSettings.angle}°</b></label><input aria-label="Gradient angle" type="range" min="0" max="360" value={modeColorSettings.angle} onChange={(event) => updateGradientBackground({ angle: Number(event.target.value) })} /></div>
              </div>
            )}
          </section>

          <section className="settings-section">
            <div className="section-title"><span>FOREGROUND</span></div>
            <div className="setting-line"><label>Theme</label><div className="segmented" role="group" aria-label="Interface theme"><button aria-pressed={state.settings.features.themeMode === "dark"} className={state.settings.features.themeMode === "dark" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, themeMode: "dark" } })}>DARK</button><button aria-pressed={state.settings.features.themeMode === "light"} className={state.settings.features.themeMode === "light" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, themeMode: "light" } })}>LIGHT</button></div></div>
            <div className="setting-line"><label>Text color</label><input aria-label="Text color" className="color-input" type="color" value={state.settings.foreground.color} onChange={(event) => updateSettings({ ...state.settings, foreground: { ...state.settings.foreground, color: event.target.value } })} /></div>
            <div className="setting-line"><label>Theme color</label><input aria-label="Theme color" className="color-input" type="color" value={state.settings.features.themeColor} onChange={(event) => updateSettings({ ...state.settings, features: { ...state.settings.features, themeColor: event.target.value } })} /></div>
            <div className="setting-line size-line"><label>Text size <b>{state.settings.foreground.fontSize}px</b></label><input aria-label="Text size" type="range" min="12" max="24" step="1" value={state.settings.foreground.fontSize} onChange={(event) => updateSettings({ ...state.settings, foreground: { ...state.settings.foreground, fontSize: Number(event.target.value) } })} /></div>
            <div className="setting-line"><label>Clock</label><ClockPicker label="Clock position" value={state.settings.clockPosition} onChange={(clockPosition) => updateSettings({ ...state.settings, clockPosition })} /></div>
            <div className="setting-line"><label>Clock seconds</label><VisibilityToggle label="Clock seconds" visible={state.settings.features.clockSeconds} onChange={(clockSeconds) => updateSettings({ ...state.settings, features: { ...state.settings.features, clockSeconds } })} /></div>
          </section>

          <section className="settings-section">
            <div className="section-title"><span>HOME GRID</span><i>{state.settings.layout.rows} × {state.settings.layout.columns}</i></div>
            <div className="setting-line"><label>Rows</label><OptionPicker label="Home grid rows" value={state.settings.layout.rows} options={[1, 2, 3, 4, 5, 6, 7, 8]} suffix="ROWS" onChange={(rows) => updateSettings({ ...state.settings, layout: { ...state.settings.layout, rows } })} /></div>
            <div className="setting-line"><label>Columns</label><OptionPicker label="Home grid columns" value={state.settings.layout.columns} options={[2, 3, 4, 5, 6, 7, 8]} suffix="COLS" onChange={(columns) => updateSettings({ ...state.settings, layout: { ...state.settings.layout, columns } })} /></div>
            <div className="setting-line"><label>Bookmark alignment</label><AlignmentPicker value={state.settings.layout.bookmarkAlignment} onChange={(bookmarkAlignment) => updateSettings({ ...state.settings, layout: { ...state.settings.layout, bookmarkAlignment } })} /></div>
            <div className="setting-line"><label>Bookmark details</label><VisibilityToggle label="Bookmark details" visible={state.settings.features.bookmarkDetails} onChange={(bookmarkDetails) => updateSettings({ ...state.settings, features: { ...state.settings.features, bookmarkDetails } })} /></div>
            <div className="setting-line"><label>Hover highlight</label><div className="segmented" role="group" aria-label="Hover highlight"><button aria-pressed={state.settings.features.hoverStyle === "underline"} className={state.settings.features.hoverStyle === "underline" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, hoverStyle: "underline" } })}>LINE</button><button aria-pressed={state.settings.features.hoverStyle === "box"} className={state.settings.features.hoverStyle === "box" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, hoverStyle: "box" } })}>BOX</button><button aria-pressed={state.settings.features.hoverStyle === "block"} className={state.settings.features.hoverStyle === "block" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, hoverStyle: "block" } })}>BLOCK</button></div></div>
            <div className="setting-line"><label>Search</label><ClockPicker label="Search position" value={state.settings.features.searchPosition} onChange={(searchPosition) => { if (searchPosition === "hidden") { setQuery(""); setSearchResultsOpen(false); } updateSettings({ ...state.settings, features: { ...state.settings.features, searchPosition } }); }} /></div>
            <div className="setting-line"><label>Search icon</label><VisibilityToggle label="Search icon" visible={state.settings.features.searchIcon} onChange={(searchIcon) => updateSettings({ ...state.settings, features: { ...state.settings.features, searchIcon } })} /></div>
            <div className="setting-line"><label>Search text</label><SearchTextPicker value={state.settings.features.searchText} onChange={(searchText) => updateSettings({ ...state.settings, features: { ...state.settings.features, searchText } })} /></div>
          </section>

          <section className="settings-section">
            <div className="section-title"><span>SYNC</span></div>
            <div className="token-row"><input aria-label="GitHub token" type="text" value={token} onChange={(event) => setToken(event.target.value)} placeholder={state.tokenConfigured ? "TOKEN SAVED / CLEAR TO DISCONNECT" : "GITHUB TOKEN"} autoComplete="off" autoCapitalize="none" spellCheck={false} /><button disabled={busy || (!token.trim() && !state.tokenConfigured)} onClick={() => props.onSaveToken?.(token)}>{state.tokenConfigured && !token.trim() ? "CLEAR" : "SAVE"}</button></div>
            {!readonly && <div className="compact-actions sync-actions">
              <button disabled={busy || !state.tokenConfigured} onClick={props.onUpload}>UPLOAD</button>
              <button
                disabled={busy || !state.tokenConfigured}
                onMouseEnter={preloadDiffView}
                onFocus={preloadDiffView}
                onPointerDown={preloadDiffView}
                onClick={props.onCompareRemote}
              >
                DIFF
              </button>
              {state.gistUrl && <a href={state.gistUrl} target="_blank" rel="noreferrer">OPEN ↗</a>}
            </div>}
          </section>

          {props.error && <div className="error-card">{props.error}</div>}
        </div>
      </aside></>}

      {visibleDiff && diffKey && props.onCloseDiff && <Suspense fallback={<div className="modal-backdrop"><div className="loading-dialog">LOADING DIFF…</div></div>}>
        <DiffView
        key={diffKey}
        diff={visibleDiff}
        busy={busy}
        onClose={() => { setDismissedDiffKey(diffKey); props.onCloseDiff?.(diffKey); }}
        onUseLeft={() => {
          setDismissedDiffKey(diffKey);
          const action = props.onUseLocal ? props.onUseLocal(diffKey) : props.onCloseDiff?.(diffKey);
          void Promise.resolve(action).catch(() => setDismissedDiffKey(undefined));
        }}
        onUseRight={() => {
          setDismissedDiffKey(diffKey);
          notesAppRef.current?.pausePersistence();
          if (!props.onUseRemote) {
            props.onCloseDiff?.(diffKey);
            return;
          }
          void Promise.resolve(props.onUseRemote(diffKey)).then(() => {
            setNotesResetKey((current) => current + 1);
          }).catch(() => {
            setDismissedDiffKey(undefined);
            notesAppRef.current?.resumePersistence();
          });
        }}
        />
      </Suspense>}
    </main>
  );
}
