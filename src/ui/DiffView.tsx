import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { json } from "@codemirror/lang-json";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { X } from "lucide-react";
import type { DiffPayload } from "../shared/model";
import { prettySnapshot } from "../shared/snapshot";
import { scrollbarMetrics, type ScrollbarMetrics } from "./scrollbar";

interface Props {
  diff: DiffPayload;
  busy?: boolean;
  onClose: () => void;
  onUseLeft: () => void;
  onUseRight: () => void;
}

const DIFF_SCROLLBAR_INSET = 2;
const DIFF_SCROLLBAR_MAX_LENGTH = 20;

const diffDarkTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "#dce7e3",
    backgroundColor: "#080d10"
  },
  ".cm-scroller": {
    backgroundColor: "#080d10"
  },
  ".cm-content": {
    caretColor: "#74d8c1"
  },
  ".cm-line": {
    padding: "0 9px"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#74d8c1"
  },
  ".cm-gutters": {
    color: "#65746f",
    backgroundColor: "#0b1216",
    border: "none"
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "rgba(116, 216, 193, .045)"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(116, 216, 193, .18)"
  }
}, { dark: true });

export function DiffView({ diff, busy = false, onClose, onUseLeft, onUseRight }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [documents, setDocuments] = useState<{ left: string; right: string }>();
  const [closing, setClosing] = useState(false);
  const [scrollbar, setScrollbar] = useState<ScrollbarMetrics>({ visible: false, offset: 0, length: DIFF_SCROLLBAR_MAX_LENGTH });
  const scrollbarDragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([prettySnapshot(diff.left), prettySnapshot(diff.right)]).then(([left, right]) => {
      if (active) setDocuments({ left, right });
    });
    return () => { active = false; };
  }, [diff]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setClosing(true);
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!host.current || !documents) return;
    const view = new MergeView({
      a: { doc: documents.left, extensions: [json(), EditorView.editable.of(false), EditorView.lineWrapping, diffDarkTheme] },
      b: { doc: documents.right, extensions: [json(), EditorView.editable.of(false), EditorView.lineWrapping, diffDarkTheme] },
      parent: host.current,
      collapseUnchanged: { margin: 3, minSize: 8 }
    });
    const scroller = host.current.querySelector<HTMLElement>(".cm-mergeView");
    scrollerRef.current = scroller;
    let observer: ResizeObserver | undefined;
    if (scroller) {
      const update = () => setScrollbar(scrollbarMetrics(scroller, { inset: DIFF_SCROLLBAR_INSET, maxLength: DIFF_SCROLLBAR_MAX_LENGTH }));
      update();
      scroller.addEventListener("scroll", update, { passive: true });
      observer = new ResizeObserver(update);
      observer.observe(scroller);
      observer.observe(scroller.firstElementChild ?? scroller);
    }
    return () => {
      observer?.disconnect();
      view.destroy();
      scrollerRef.current = null;
    };
  }, [documents]);

  const dragScrollbar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = scrollbarDragRef.current;
    const area = scrollerRef.current;
    if (!drag || !area || drag.pointerId !== event.pointerId) return;
    const scrollRange = area.scrollHeight - area.clientHeight;
    const trackLength = Math.max(0, area.clientHeight - DIFF_SCROLLBAR_INSET * 2);
    const travel = trackLength - scrollbar.length;
    if (travel > 0) area.scrollTop = drag.startScrollTop + ((event.clientY - drag.startY) / travel) * scrollRange;
  };

  const dismiss = (action: () => void) => {
    setClosing(true);
    action();
  };

  if (closing) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Snapshot comparison">
      <section className="diff-dialog" ref={dialog}>
        <header className="diff-header">
          <h2>SNAPSHOT DIFF</h2>
          <button ref={closeRef} className="icon-button" onClick={() => dismiss(onClose)} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="diff-labels"><span>LOCAL CURRENT</span><span>GIST REMOTE</span></div>
        <div className="merge-frame">
          <div className="merge-host" ref={host}>{!documents && <div className="loading">GENERATING LOCAL DIFF…</div>}</div>
          {scrollbar.visible && <div className="diff-scrollbar" aria-hidden="true">
            <div
              className="diff-scrollbar-thumb"
              style={{ height: scrollbar.length, transform: `translateY(${scrollbar.offset}px)` }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                scrollbarDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: scrollerRef.current?.scrollTop ?? 0 };
              }}
              onPointerMove={dragScrollbar}
              onPointerUp={(event) => {
                if (scrollbarDragRef.current?.pointerId === event.pointerId) scrollbarDragRef.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { scrollbarDragRef.current = null; }}
            />
          </div>}
        </div>
        <footer className="diff-actions">
          <button className="button secondary" disabled={busy} onClick={() => dismiss(onUseLeft)}>USE LOCAL</button>
          <button className="button primary" disabled={busy} onClick={() => dismiss(onUseRight)}>USE REMOTE</button>
        </footer>
      </section>
    </div>
  );
}

export default DiffView;
