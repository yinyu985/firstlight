// A pair of RGBA16F dye textures uses at most 64 MiB, independent of aspect ratio.
export const MAX_FLUID_TEXTURE_PIXELS = 4_194_304;
// Six simulation attachments remain below 12 MiB even on RGBA16F-only hardware.
export const MAX_FLUID_SIM_PIXELS = 262_144;
export const MAX_DOTS = 25_000;

export function boundedTextureSize(width: number, height: number, hardwareLimit: number, pixelBudget = MAX_FLUID_TEXTURE_PIXELS) {
  const scale = Math.min(1, hardwareLimit / width, hardwareLimit / height, Math.sqrt(pixelBudget / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function boundedDotGrid(width: number, height: number, dotSize: number, gap: number) {
  let cell = dotSize + gap;
  let cols = Math.floor((width + gap) / cell);
  let rows = Math.floor((height + gap) / cell);
  if (cols * rows > MAX_DOTS) {
    cell *= Math.sqrt((cols * rows) / MAX_DOTS);
    cols = Math.floor(width / cell);
    rows = Math.floor(height / cell);
  }
  return { cols, rows, cell, gap: cell - dotSize };
}
