import { useCallback, useEffect, useMemo, useState } from "react";

export function useClock(showSeconds: boolean, enabled = true): string {
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: showSeconds ? "2-digit" : undefined,
        hour12: false
      }),
    [showSeconds]
  );
  const format = useCallback(() => formatter.format(new Date()), [formatter]);
  const [clock, setClock] = useState(format);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const interval = showSeconds ? 1_000 : 60_000;
    const update = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      setClock(format());
      timer = window.setTimeout(update, interval - (Date.now() % interval));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled, format, showSeconds]);
  return clock;
}
