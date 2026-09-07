export interface NormalizedPointer {
  x: number;
  y: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizedCanvasPointer(canvas: HTMLCanvasElement, clientX: number, clientY: number): NormalizedPointer | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01(1 - (clientY - rect.top) / rect.height)
  };
}

export function bindWindowPointer(
  canvas: HTMLCanvasElement,
  onMove: (pointer: NormalizedPointer) => void,
  onActiveChange?: (active: boolean) => void
): () => void {
  const handleMove = (event: PointerEvent) => {
    const pointer = normalizedCanvasPointer(canvas, event.clientX, event.clientY);
    if (!pointer) return;
    onMove(pointer);
    onActiveChange?.(true);
  };
  const handleOut = (event: PointerEvent) => {
    if (event.relatedTarget === null) onActiveChange?.(false);
  };
  const handleBlur = () => onActiveChange?.(false);

  window.addEventListener("pointermove", handleMove, { capture: true, passive: true });
  window.addEventListener("pointerout", handleOut, { capture: true, passive: true });
  window.addEventListener("blur", handleBlur);

  return () => {
    window.removeEventListener("pointermove", handleMove, true);
    window.removeEventListener("pointerout", handleOut, true);
    window.removeEventListener("blur", handleBlur);
  };
}
