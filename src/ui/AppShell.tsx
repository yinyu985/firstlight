import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Notebook, Search, Settings } from "lucide-react";
import type { Background, BookmarkAlignment, BookmarkItem, ClockPosition, SyncedSettings, SyncNote } from "../shared/model";
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
  onUseLocal?: () => void;
  onUseRemote?: () => void | Promise<void>;
  onCloseDiff?: () => void;
  onOpenBookmarkManager?: () => void;
  onSaveNotes?: (notes: SyncNote[]) => void | Promise<void>;
}

const GRID_COLUMN_WIDTH = 210;
const GRID_COLUMN_MIN_WIDTH = 170;
const GRID_COLUMN_GAP = 15;
const GRID_COLUMN_COMPACT_GAP = 8;

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

function backgroundImageCss(settings: SyncedSettings): string {
  const background = settings.background;
  if (background.type === "solid") return "none";
  return `linear-gradient(${background.angle}deg in oklab, ${background.from}, ${background.to})`;
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
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  if (!nodes.length) return <div className="folder-empty">EMPTY</div>;
  return <div className="folder-list">
    {nodes.map((item, index) => {
      const isFolder = item.children !== undefined;
      const isExpanded = expanded.has(index);
      return <div className="folder-entry" key={`${item.title}-${index}`}>
        <button
          className={`folder-row ${isFolder ? "is-folder" : ""}`}
          disabled={!isFolder && item.url !== undefined && !canOpenBookmark(item.url)}
          onClick={() => {
            if (isFolder) {
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(index)) next.delete(index); else next.add(index);
                return next;
              });
            } else onOpen(item);
          }}
        >
          <span className="folder-row-content">
            {isFolder && <span className="row-mark">{isExpanded ? "−" : "+"}</span>}
            <span className="row-title">{item.title || "UNTITLED"}</span>
            {isFolder && showDetails && <span className="row-count">{countUrls(item.children ?? [])}</span>}
          </span>
        </button>
        {isFolder && isExpanded && <FolderList nodes={item.children ?? []} onOpen={onOpen} showDetails={showDetails} />}
      </div>;
    })}
  </div>;
}

function FolderPopover({ nodes, onOpen, background, foreground, showDetails }: { nodes: BookmarkItem[]; onOpen: (item: BookmarkItem) => void; background: Background; foreground: string; showDetails: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(240);
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
  return <div className="folder-popover" ref={ref} style={{ maxHeight, ...localThemeVariables(theme) }}>
    <FolderList nodes={nodes} onOpen={onOpen} showDetails={showDetails} />
  </div>;
}

interface OptionPickerProps {
  value: number;
  options: number[];
  suffix: string;
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

function OptionPicker({ value, options, suffix, onChange }: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" onClick={() => setOpen((current) => !current)}><span>{value} {suffix}</span><b className="picker-arrow" /></button>
    {open && <div className="picker-menu">{options.map((option) => <button key={option} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option}</button>)}</div>}
  </div>;
}

function ClockPicker({ value, onChange }: { value: ClockPosition; onChange: (value: ClockPosition) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  const options: ClockPosition[] = ["hidden", "left", "center", "right"];
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" onClick={() => setOpen((current) => !current)}><span>{value.toUpperCase()}</span><b className="picker-arrow" /></button>
    {open && <div className="picker-menu clock-menu">{options.map((option) => <button key={option} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option.toUpperCase()}</button>)}</div>}
  </div>;
}

function AlignmentPicker({ value, onChange }: { value: BookmarkAlignment; onChange: (value: BookmarkAlignment) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissablePicker(open, setOpen);
  const options: BookmarkAlignment[] = ["left", "center", "right"];
  return <div className={`option-picker ${open ? "open" : ""}`} ref={ref}>
    <button className="picker-trigger" onClick={() => setOpen((current) => !current)}><span>{value.toUpperCase()}</span><b className="picker-arrow" /></button>
    {open && <div className="picker-menu alignment-menu">{options.map((option) => <button key={option} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option.toUpperCase()}</button>)}</div>}
  </div>;
}

function VisibilityToggle({ visible, onChange }: { visible: boolean; onChange: (visible: boolean) => void }) {
  return <div className="segmented visibility-toggle"><button className={visible ? "selected" : ""} onClick={() => onChange(true)}>SHOW</button><button className={!visible ? "selected" : ""} onClick={() => onChange(false)}>HIDE</button></div>;
}

export function AppShell(props: Props) {
  const { state } = props;
  const clock = useClock(state.settings.features.clockSeconds);
  const [query, setQuery] = useState("");
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(props.openSetupOnLaunch));
  const [openFolder, setOpenFolder] = useState<number | null>(null);
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
  const [contentBounds, setContentBounds] = useState<{ left: number; width: number }>();
  const results = useMemo(() => searchBookmarks(state.bookmarks, query), [state.bookmarks, query]);
  const readonly = state.target === "online";
  const searchPosition = state.settings.features.searchPosition;
  const folderTheme = useMemo(
    () => deriveFolderTheme(state.settings.background, state.settings.foreground.color),
    [state.settings.background, state.settings.foreground.color]
  );
  const remoteOperationActive = state.tokenConfigured && (
    state.sync.phase === "uploading" || state.sync.phase === "discovering" || state.sync.phase === "restoring"
  );
  const notificationMessage = showSyncNotice ? state.sync.message : visibleToast?.message;
  const hasNotification = Boolean(notificationMessage);
  const diffKey = state.diff
    ? `${state.diff.source}:${state.diff.left.updatedAt}:${state.diff.right.updatedAt}`
    : undefined;
  const visibleDiff = state.diff && diffKey !== dismissedDiffKey ? state.diff : undefined;
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
    if (!settingsOpen) return;
    preloadDiffView();
  }, [settingsOpen]);

  useEffect(() => {
    setOpenFolder(null);
  }, [state.settings.layout.rows, state.settings.layout.columns]);

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
    };
    document.addEventListener("pointerdown", closeDetachedLists);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeDetachedLists);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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
  const setBackground = (background: SyncedSettings["background"]) => updateSettings({ ...state.settings, background });
  const gridWidth = gridFit.columns * gridFit.columnWidth + (gridFit.columns - 1) * gridFit.gap;
  const contentFrameStyle = contentBounds ? { width: contentBounds.width, marginLeft: contentBounds.left } : undefined;
  const searchResultStyle = contentBounds ? {
    width: contentBounds.width / 2,
    marginLeft: contentBounds.left + (searchPosition === "center" ? contentBounds.width / 4 : searchPosition === "right" ? contentBounds.width / 2 : 0)
  } : undefined;

  return (
    <main className={`app theme-${state.settings.features.themeMode} bookmarks-${state.settings.layout.bookmarkAlignment} hover-${state.settings.features.hoverStyle} ${state.settings.background.type === "dynamic" ? "background-dynamic" : ""}`} style={{
      backgroundColor: state.settings.background.type === "solid"
        ? state.settings.background.color
        : state.settings.background.type === "dynamic"
          ? `color-mix(in oklab, ${state.settings.background.from} 50%, ${state.settings.background.to})`
          : state.settings.background.from,
      backgroundImage: backgroundImageCss(state.settings),
      color: state.settings.foreground.color,
      "--foreground-color": state.settings.foreground.color,
      "--bookmark-font-size": `${state.settings.foreground.fontSize}px`,
      "--ui-font-size": `${state.settings.foreground.fontSize}px`,
      "--hover-color": state.settings.features.hoverColor,
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
      {state.settings.background.type === "dynamic" && <DynamicBackground background={state.settings.background} />}
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

        {searchPosition !== "hidden" && <div className={`search-shell search-${searchPosition}`} style={contentFrameStyle}><label className="search-box">
          {state.settings.features.searchIcon && <span className="search-prefix"><Search size={20} strokeWidth={1.8} /></span>}
          <input value={query} onFocus={() => { if (query) setSearchResultsOpen(true); }} onChange={(event) => { setQuery(event.target.value); setSearchResultsOpen(Boolean(event.target.value)); setOpenFolder(null); }} placeholder={state.settings.features.searchText ? "SEARCH BOOKMARKS" : ""} aria-label="Search bookmarks" autoComplete="off" />
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
            const active = openFolder === index;
            return <div className={`bookmark-cell-wrap ${active ? "active" : ""}`} key={`${item.title}-${index}`}>
              <button
                className="bookmark-cell"
                disabled={!folder && item.url !== undefined && !canOpenBookmark(item.url)}
                onClick={() => folder ? setOpenFolder(active ? null : index) : open(item)}
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

      <button className="settings-trigger" onClick={(event) => { event.stopPropagation(); setSettingsOpen(true); }} aria-label="Open settings"><Settings size={20} strokeWidth={1.8} /></button>

      {settingsOpen && <><div className="drawer-backdrop" onClick={() => setSettingsOpen(false)} />
      <aside className="settings-drawer open" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header"><span className="brand-lockup"><img src="./firstlight-mark.png" alt="" />FIRSTLIGHT</span></header>
        <div className="drawer-content">
          <section className="settings-section">
            <div className="section-title"><span>BOOKMARKS</span>{!readonly && <button onClick={props.onOpenBookmarkManager}>OPEN MANAGER ↗</button>}</div>
            <div className="setting-line"><label>Open target</label><div className="segmented"><button className={state.settings.openTarget === "new-tab" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, openTarget: "new-tab" })}>NEW TAB</button><button className={state.settings.openTarget === "current-tab" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, openTarget: "current-tab" })}>CURRENT</button></div></div>
            {!readonly && <div className="setting-line"><label>Chrome import</label><button className="inline-action" onClick={props.onImportBookmarks}>IMPORT</button></div>}
          </section>

          <section className="settings-section">
            <div className="section-title"><span>BACKGROUND</span></div>
            <div className="setting-line"><label>Mode</label><div className="segmented"><button className={state.settings.background.type === "solid" ? "selected" : ""} onClick={() => setBackground({ type: "solid", color: state.settings.background.type === "solid" ? state.settings.background.color : state.settings.background.from })}>SOLID</button><button className={state.settings.background.type === "gradient" ? "selected" : ""} onClick={() => setBackground({ type: "gradient", from: state.settings.background.type === "solid" ? state.settings.background.color : state.settings.background.from, to: state.settings.background.type === "solid" ? "#13242a" : state.settings.background.to, angle: state.settings.background.type === "solid" ? 145 : state.settings.background.angle })}>GRADIENT</button><button className={state.settings.background.type === "dynamic" ? "selected" : ""} onClick={() => setBackground({ type: "dynamic", from: state.settings.background.type === "solid" ? state.settings.background.color : state.settings.background.from, to: state.settings.background.type === "solid" ? "#13242a" : state.settings.background.to, angle: state.settings.background.type === "solid" ? 145 : state.settings.background.angle, speed: state.settings.background.type === "dynamic" ? state.settings.background.speed : 10 })}>DYNAMIC</button></div></div>
            {state.settings.background.type === "solid" ? <div className="setting-line"><label>Color</label><input className="color-input" type="color" value={state.settings.background.color} onChange={(event) => setBackground({ type: "solid", color: event.target.value })} /></div> : (() => {
              const gradient = state.settings.background;
              return <><div className="setting-line"><label>Colors</label><div className="color-pair"><input type="color" value={gradient.from} onChange={(event) => setBackground({ ...gradient, from: event.target.value })} /><input type="color" value={gradient.to} onChange={(event) => setBackground({ ...gradient, to: event.target.value })} /></div></div><div className="setting-line angle-line"><label>Angle <b>{gradient.angle}°</b></label><input type="range" min="0" max="360" value={gradient.angle} onChange={(event) => setBackground({ ...gradient, angle: Number(event.target.value) })} /></div>{gradient.type === "dynamic" && <div className="setting-line size-line speed-line"><label>Speed <b>{gradient.speed}</b></label><input type="range" min="10" max="20" step="1" value={gradient.speed} onChange={(event) => setBackground({ ...gradient, speed: Number(event.target.value) })} /></div>}</>;
            })()}
          </section>

          <section className="settings-section">
            <div className="section-title"><span>FOREGROUND</span></div>
            <div className="setting-line"><label>Interface theme</label><div className="segmented"><button className={state.settings.features.themeMode === "dark" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, themeMode: "dark" } })}>DARK</button><button className={state.settings.features.themeMode === "light" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, themeMode: "light" } })}>LIGHT</button></div></div>
            <div className="setting-line"><label>Text color</label><input className="color-input" type="color" value={state.settings.foreground.color} onChange={(event) => updateSettings({ ...state.settings, foreground: { ...state.settings.foreground, color: event.target.value } })} /></div>
            <div className="setting-line size-line"><label>Text size <b>{state.settings.foreground.fontSize}px</b></label><input type="range" min="12" max="24" step="1" value={state.settings.foreground.fontSize} onChange={(event) => updateSettings({ ...state.settings, foreground: { ...state.settings.foreground, fontSize: Number(event.target.value) } })} /></div>
            <div className="setting-line"><label>Clock</label><ClockPicker value={state.settings.clockPosition} onChange={(clockPosition) => updateSettings({ ...state.settings, clockPosition })} /></div>
            <div className="setting-line"><label>Clock seconds</label><VisibilityToggle visible={state.settings.features.clockSeconds} onChange={(clockSeconds) => updateSettings({ ...state.settings, features: { ...state.settings.features, clockSeconds } })} /></div>
          </section>

          <section className="settings-section">
            <div className="section-title"><span>HOME GRID</span><i>{state.settings.layout.rows} × {state.settings.layout.columns}</i></div>
            <div className="setting-line"><label>Rows</label><OptionPicker value={state.settings.layout.rows} options={[1, 2, 3, 4, 5, 6, 7, 8]} suffix="ROWS" onChange={(rows) => updateSettings({ ...state.settings, layout: { ...state.settings.layout, rows } })} /></div>
            <div className="setting-line"><label>Columns</label><OptionPicker value={state.settings.layout.columns} options={[2, 3, 4, 5, 6, 7, 8]} suffix="COLS" onChange={(columns) => updateSettings({ ...state.settings, layout: { ...state.settings.layout, columns } })} /></div>
            <div className="setting-line"><label>Bookmark alignment</label><AlignmentPicker value={state.settings.layout.bookmarkAlignment} onChange={(bookmarkAlignment) => updateSettings({ ...state.settings, layout: { ...state.settings.layout, bookmarkAlignment } })} /></div>
            <div className="setting-line"><label>Bookmark details</label><VisibilityToggle visible={state.settings.features.bookmarkDetails} onChange={(bookmarkDetails) => updateSettings({ ...state.settings, features: { ...state.settings.features, bookmarkDetails } })} /></div>
            <div className="setting-line"><label>Hover highlight</label><div className="segmented"><button className={state.settings.features.hoverStyle === "underline" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, hoverStyle: "underline" } })}>LINE</button><button className={state.settings.features.hoverStyle === "box" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, hoverStyle: "box" } })}>BOX</button><button className={state.settings.features.hoverStyle === "block" ? "selected" : ""} onClick={() => updateSettings({ ...state.settings, features: { ...state.settings.features, hoverStyle: "block" } })}>BLOCK</button></div></div>
            <div className="setting-line"><label>Highlight color</label><input className="color-input" type="color" value={state.settings.features.hoverColor} onChange={(event) => updateSettings({ ...state.settings, features: { ...state.settings.features, hoverColor: event.target.value } })} /></div>
            <div className="setting-line"><label>Search</label><ClockPicker value={state.settings.features.searchPosition} onChange={(searchPosition) => { if (searchPosition === "hidden") { setQuery(""); setSearchResultsOpen(false); } updateSettings({ ...state.settings, features: { ...state.settings.features, searchPosition } }); }} /></div>
            <div className="setting-line"><label>Search icon</label><VisibilityToggle visible={state.settings.features.searchIcon} onChange={(searchIcon) => updateSettings({ ...state.settings, features: { ...state.settings.features, searchIcon } })} /></div>
            <div className="setting-line"><label>Search text</label><VisibilityToggle visible={state.settings.features.searchText} onChange={(searchText) => updateSettings({ ...state.settings, features: { ...state.settings.features, searchText } })} /></div>
          </section>

          <section className="settings-section">
            <div className="section-title"><span>SYNC</span><i className={`phase-${state.sync.phase}`}>{state.sync.gistId ? "ON" : "OFF"}</i></div>
            <div className="token-row"><input type="text" value={token} onChange={(event) => setToken(event.target.value)} placeholder={state.tokenConfigured ? "TOKEN SAVED / ENTER TO REPLACE" : "GITHUB TOKEN"} autoComplete="off" autoCapitalize="none" spellCheck={false} /><button disabled={!token.trim()} onClick={() => props.onSaveToken?.(token)}>SAVE</button></div>
            {!readonly && <div className="compact-actions sync-actions">
              <button disabled={!state.tokenConfigured} onClick={props.onUpload}>UPLOAD</button>
              <button
                disabled={!state.tokenConfigured}
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
        onClose={() => { setDismissedDiffKey(diffKey); props.onCloseDiff?.(); }}
        onUseLeft={() => {
          setDismissedDiffKey(diffKey);
          (props.onUseLocal ?? props.onCloseDiff)?.();
        }}
        onUseRight={() => {
          setDismissedDiffKey(diffKey);
          notesAppRef.current?.pausePersistence();
          if (!props.onUseRemote) {
            props.onCloseDiff?.();
            return;
          }
          void Promise.resolve(props.onUseRemote()).then(() => {
            setNotesResetKey((current) => current + 1);
          }).catch(() => {
            notesAppRef.current?.resumePersistence();
          });
        }}
        />
      </Suspense>}
    </main>
  );
}
