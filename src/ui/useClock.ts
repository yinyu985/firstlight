import { useEffect, useState } from "react";

export function useClock(showSeconds: boolean): string {
  const format = () => new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds ? "2-digit" : undefined,
    hour12: false
  }).format(new Date());
  const [clock, setClock] = useState(format);
  useEffect(() => {
    setClock(format());
    const timer = window.setInterval(() => setClock(format()), 1000);
    return () => window.clearInterval(timer);
  }, [showSeconds]);
  return clock;
}
