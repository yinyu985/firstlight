import { useClock } from "./useClock";

export function Clock({ showSeconds }: { showSeconds: boolean }) {
  const clock = useClock(showSeconds);
  return <time>{clock}</time>;
}
