export const BACKGROUND_FPS = 60;

/** Keep elapsed time in the renderer; this gate only limits expensive drawing. */
export function createFrameGate(fps = BACKGROUND_FPS): (timestamp: number) => boolean {
  const interval = 1000 / fps;
  let next = -Infinity;
  return (timestamp) => {
    if (timestamp + 0.1 < next) return false;
    next = timestamp + interval - (Number.isFinite(next) ? Math.max(0, timestamp - next) % interval : 0);
    return true;
  };
}
