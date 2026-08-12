import { useEffect, useMemo, useState } from "react";

export function useClock(showSeconds: boolean, enabled = true): string {
  const formatter = useMemo(() => new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds ? "2-digit" : undefined,
    hour12: false
  }), [showSeconds]);
  const format = () => formatter.format(new Date());
  const [clock, setClock] = useState(format);
  useEffect(() => {
    if (!enabled) return;
    setClock(format());
    const timer = window.setInterval(() => setClock(format()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled, formatter]);
  return clock;
}
