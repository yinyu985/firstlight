const MAX_CANVAS_PIXELS = 3_000_000;

export function boundedCanvasSize(cssWidth: number, cssHeight: number): { width: number; height: number; dpr: number } {
  const safeWidth = Math.max(1, cssWidth);
  const safeHeight = Math.max(1, cssHeight);
  const nativeDpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const budgetDpr = Math.sqrt(MAX_CANVAS_PIXELS / (safeWidth * safeHeight));
  const dpr = Math.min(nativeDpr, budgetDpr);
  return {
    width: Math.max(1, Math.floor(safeWidth * dpr)),
    height: Math.max(1, Math.floor(safeHeight * dpr)),
    dpr
  };
}
