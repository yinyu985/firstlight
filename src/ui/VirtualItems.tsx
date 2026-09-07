import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

interface Props<T> {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  className: string;
  hostRef?: RefObject<HTMLDivElement | null>;
  columns?: number;
  rowHeight: number;
  columnWidth?: number;
  columnGap?: number;
  minimumRows?: number;
  empty?: ReactNode;
}

export function virtualRange(count: number, columns: number, rowHeight: number, offset: number, height: number) {
  const rows = Math.ceil(count / columns);
  const first = Math.max(0, Math.min(rows - 1, Math.floor(Math.max(0, offset) / rowHeight) - 6));
  return { start: first * columns, end: Math.min(count, (first + Math.ceil(height / rowHeight) + 14) * columns) };
}

/** Retains the complete scroll extent while mounting only nearby rows. */
export function VirtualItems<T>({
  items,
  renderItem,
  className,
  hostRef,
  columns = 1,
  rowHeight,
  columnWidth,
  columnGap = 0,
  minimumRows = 0,
  empty
}: Props<T>) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = hostRef ?? ownRef;
  const virtual = items.length > 500;
  const [range, setRange] = useState({ start: 0, end: 100 });
  const [focusIndex, setFocusIndex] = useState<number>();

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !virtual) return;
    const scroller = host.parentElement?.closest<HTMLElement>(".folder-scroll-area, .notes-list, .app");
    if (!scroller) return;
    const measure = () => {
      const offset = scroller.getBoundingClientRect().top - host.getBoundingClientRect().top;
      const next = virtualRange(items.length, columns, rowHeight, offset, scroller.clientHeight);
      setRange((current) => (current.start === next.start && current.end === next.end ? current : next));
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(host);
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", measure);
    };
  }, [columns, items.length, ref, rowHeight, virtual]);

  useLayoutEffect(() => {
    if (focusIndex === undefined) return;
    const target = ref.current?.querySelector<HTMLElement>(`[data-virtual-index="${focusIndex}"] button:not(:disabled)`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
    setFocusIndex(undefined);
  }, [focusIndex, ref]);

  const start = virtual ? Math.min(range.start, Math.max(0, items.length - 1)) : 0;
  const end = virtual ? Math.max(start + 1, Math.min(items.length, range.end)) : items.length;
  const style: CSSProperties | undefined = virtual
    ? { display: "block", position: "relative", height: Math.max(minimumRows, Math.ceil(items.length / columns)) * rowHeight }
    : undefined;
  return (
    <div
      ref={ref}
      className={className}
      style={style}
      data-virtualized={virtual || undefined}
      onKeyDown={(event) => {
        if (!virtual || event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
        const item = event.target.closest<HTMLElement>("[data-virtual-index]");
        if (!item) return;
        const index = Number(item.dataset.virtualIndex);
        let next: number | undefined;
        if (event.key === "ArrowDown") next = index + columns;
        else if (event.key === "ArrowUp") next = index - columns;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        else if (event.key === "Tab") {
          const controls = Array.from(item.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
          if (event.shiftKey && event.target === controls[0] && index === start && index > 0) next = index - 1;
          if (!event.shiftKey && event.target === controls.at(-1) && index === end - 1 && index < items.length - 1) next = index + 1;
        }
        if (next === undefined || next < 0 || next >= items.length) return;
        event.preventDefault();
        event.stopPropagation();
        const first = Math.max(0, Math.floor(next / columns) - 6) * columns;
        setRange({ start: first, end: Math.min(items.length, first + Math.max(100, columns * 30)) });
        setFocusIndex(next);
      }}
    >
      {!items.length
        ? empty
        : items.slice(start, end).map((item, offset) => {
            const index = start + offset;
            if (!virtual) return renderItem(item, index);
            return (
              <div
                key={index}
                data-virtual-index={index}
                style={{
                  position: "absolute",
                  top: Math.floor(index / columns) * rowHeight,
                  left: columnWidth ? (index % columns) * (columnWidth + columnGap) : 0,
                  width: columnWidth ?? "100%"
                }}
              >
                {renderItem(item, index)}
              </div>
            );
          })}
    </div>
  );
}
