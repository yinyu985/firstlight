import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BookmarkItem, Background } from "../shared/model";
import { canOpenBookmark } from "../shared/url";
import { countBookmarkUrls as countUrls } from "./bookmarks";
import { localThemeVariables, useLocalPanelTheme } from "./panelTheme";
import { VirtualItems } from "./VirtualItems";

interface FolderListProps {
  nodes: BookmarkItem[];
  onOpen: (item: BookmarkItem) => void;
  showDetails: boolean;
}

function FolderList({ nodes, onOpen, showDetails }: FolderListProps) {
  const [expanded, setExpanded] = useState<Set<BookmarkItem>>(() => new Set());
  const hostRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(26);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setRowHeight(Math.max(23, (Number.parseFloat(getComputedStyle(host).getPropertyValue("--ui-font-size")) || 11) + 10));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const visible = useMemo(() => {
    const rows: Array<{ item: BookmarkItem; depth: number }> = [];
    const walk = (items: BookmarkItem[], depth: number) => {
      for (const item of items) {
        rows.push({ item, depth });
        if (expanded.has(item)) walk(item.children ?? [], depth + 1);
      }
    };
    walk(nodes, 0);
    return rows;
  }, [nodes, expanded]);
  return (
    <VirtualItems
      className="folder-list"
      hostRef={hostRef}
      items={visible}
      rowHeight={rowHeight}
      empty={<div className="folder-empty">EMPTY</div>}
      renderItem={({ item, depth }, index) => {
        const isFolder = item.children !== undefined;
        const isExpanded = expanded.has(item);
        return (
          <div
            className={`folder-entry ${isExpanded ? "is-expanded" : ""}`}
            key={`${item.title}-${index}`}
            style={depth ? { marginLeft: Math.min(depth, 12) * 8, borderLeft: "1px solid var(--folder-border)" } : undefined}
          >
            <button
              className={`folder-row ${isFolder ? "is-folder" : ""}`}
              disabled={!isFolder && item.url !== undefined && !canOpenBookmark(item.url)}
              aria-expanded={isFolder ? isExpanded : undefined}
              onClick={() => {
                if (isFolder) {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(item)) next.delete(item);
                    else next.add(item);
                    return next;
                  });
                } else onOpen(item);
              }}
            >
              <span className="folder-row-content">
                {isFolder && (
                  <span className="row-mark" aria-hidden="true">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                )}
                <span className="row-title">{item.title || "UNTITLED"}</span>
                {isFolder && showDetails && <span className="row-count">{countUrls(item.children ?? [])}</span>}
              </span>
            </button>
          </div>
        );
      }}
    />
  );
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

export function FolderPopover({
  nodes,
  onOpen,
  background,
  foreground,
  showDetails
}: {
  nodes: BookmarkItem[];
  onOpen: (item: BookmarkItem) => void;
  background: Background;
  foreground: string;
  showDetails: boolean;
}) {
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

  return (
    <div className="folder-popover" ref={ref} style={{ maxHeight, ...localThemeVariables(theme) }}>
      <div className="folder-scroll-area" ref={scrollRef} onScroll={(event) => setScrollbar(folderScrollbarState(event.currentTarget))}>
        <div className="folder-scroll-content">
          <FolderList nodes={nodes} onOpen={onOpen} showDetails={showDetails} />
        </div>
      </div>
      {scrollbar.visible && (
        <div className="folder-scrollbar" aria-hidden="true">
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
            onPointerCancel={() => {
              scrollbarDragRef.current = null;
            }}
          />
        </div>
      )}
    </div>
  );
}
