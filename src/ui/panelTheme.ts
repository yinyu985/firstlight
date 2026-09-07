import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import type { Background } from "../shared/model";
import { deriveFolderTheme, type FolderTheme } from "./theme";

export function localThemeVariables(theme: FolderTheme): CSSProperties {
  return {
    "--folder-surface": theme.surface,
    "--folder-border": theme.border,
    "--folder-hover": theme.hover,
    "--folder-shadow": theme.shadow
  } as CSSProperties;
}

export function useLocalPanelTheme(ref: RefObject<HTMLElement | null>, background: Background, foreground: string, active = true): FolderTheme {
  const fallback = useMemo(() => deriveFolderTheme(background, foreground), [background, foreground]);
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
      setTheme((current) =>
        current.surface === next.surface && current.border === next.border && current.hover === next.hover && current.shadow === next.shadow ? current : next
      );
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
