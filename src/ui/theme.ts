import type { Background } from "../shared/model";
import { NEURO_NOISE_DEFAULT_COLORS } from "../shared/dynamicEffects";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Oklab {
  l: number;
  a: number;
  b: number;
}

export interface BackgroundSample {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FolderTheme {
  surface: string;
  border: string;
  hover: string;
  shadow: string;
}

function parseHex(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  };
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((value) =>
      Math.round(Math.max(0, Math.min(255, value)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function mix(color: string, target: Rgb, amount: number): string {
  const source = parseHex(color);
  return toHex({
    r: source.r + (target.r - source.r) * amount,
    g: source.g + (target.g - source.g) * amount,
    b: source.b + (target.b - source.b) * amount
  });
}

function luminance(color: string): number {
  const { r, g, b } = parseHex(color);
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const channel = Math.max(0, Math.min(1, value));
  return 255 * (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);
}

function toOklab(color: string): Oklab {
  const rgb = parseHex(color);
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  };
}

function fromOklab(color: Oklab): string {
  const l = (color.l + 0.3963377774 * color.a + 0.2158037573 * color.b) ** 3;
  const m = (color.l - 0.1055613458 * color.a - 0.0638541728 * color.b) ** 3;
  const s = (color.l - 0.0894841775 * color.a - 1.291485548 * color.b) ** 3;
  return toHex({
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  });
}

function interpolateOklab(from: string, to: string, amount: number): string {
  const start = toOklab(from);
  const end = toOklab(to);
  const t = Math.max(0, Math.min(1, amount));
  return fromOklab({
    l: start.l + (end.l - start.l) * t,
    a: start.a + (end.a - start.a) * t,
    b: start.b + (end.b - start.b) * t
  });
}

export function sampleBackground(background: Background, sample: BackgroundSample): string {
  if (background.type === "solid") return background.color;
  if (background.type === "dynamic" && background.effect === "neuroNoise") {
    const colorBack = background.parameters?.colorBack;
    return typeof colorBack === "string" ? colorBack : NEURO_NOISE_DEFAULT_COLORS.back;
  }
  const radians = (background.angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const width = Math.max(1, sample.width);
  const height = Math.max(1, sample.height);
  const extent = Math.abs(dx) * width + Math.abs(dy) * height;
  const centeredX = sample.x - width / 2;
  const centeredY = sample.y - height / 2;
  const amount = 0.5 + (centeredX * dx + centeredY * dy) / extent;
  return interpolateOklab(background.from, background.to, amount);
}

export function deriveFolderTheme(background: Background, foreground: string, sample: BackgroundSample = { x: 0.5, y: 0.5, width: 1, height: 1 }): FolderTheme {
  if (background.type === "dynamic") {
    const lightText = luminance(foreground) >= 0.45;
    return {
      surface: lightText ? "rgba(5,7,8,.3)" : "rgba(255,255,255,.32)",
      border: `color-mix(in srgb, ${foreground} 24%, transparent)`,
      hover: `color-mix(in srgb, ${foreground} 10%, transparent)`,
      shadow: "rgba(0,0,0,.34)"
    };
  }
  const localColor = sampleBackground(background, sample);
  const localLuminance = luminance(localColor);
  const target = localLuminance < 0.42 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const lift = localLuminance < 0.42 ? 0.105 : 0.07;

  return {
    surface: mix(localColor, target, lift),
    border: `color-mix(in srgb, ${foreground} 30%, transparent)`,
    hover: `color-mix(in srgb, ${foreground} 9%, transparent)`,
    shadow: localLuminance < 0.42 ? "rgba(0,0,0,.42)" : "rgba(20,24,22,.2)"
  };
}
