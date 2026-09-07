import { Suspense, lazy, useEffect, useRef } from "react";
import type { DynamicBackground as DynamicBackgroundSettings } from "../shared/model";
import type { DynamicEffect } from "../shared/dynamicEffects";
const NeuroNoise = lazy(() => import("./backgrounds/NeuroNoise").then((module) => ({ default: module.NeuroNoise })));

const DotGrid = lazy(() => import("./backgrounds/DotGrid").then((module) => ({ default: module.DotGrid })));
const Galaxy = lazy(() => import("./backgrounds/Galaxy").then((module) => ({ default: module.Galaxy })));
const LightPillar = lazy(() => import("./backgrounds/LightPillar").then((module) => ({ default: module.LightPillar })));
const Snow = lazy(() => import("./backgrounds/Snow").then((module) => ({ default: module.Snow })));
const SilkFlow = lazy(() => import("./backgrounds/SilkFlow").then((module) => ({ default: module.SilkFlow })));
const Flash = lazy(() => import("./backgrounds/Flash").then((module) => ({ default: module.Flash })));

type ColorDynamicBackgroundSettings = Exclude<DynamicBackgroundSettings, { effect: "neuroNoise" }>;

interface Props {
  background: DynamicBackgroundSettings;
}

interface FrameConfig {
  angle: number;
  density: number;
  from: [number, number, number];
  smokeCount: number;
  smokeSpread: number;
  speed: number;
  to: [number, number, number];
  turbulence: number;
  wallThickness: number;
}

interface Renderer {
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  position: number;
  program: WebGLProgram;
  uniforms: {
    angle: WebGLUniformLocation | null;
    from: WebGLUniformLocation | null;
    density: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    seed: WebGLUniformLocation | null;
    smokeCount: WebGLUniformLocation | null;
    smokeSpread: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    to: WebGLUniformLocation | null;
    turbulence: WebGLUniformLocation | null;
    wallThickness: WebGLUniformLocation | null;
  };
}

const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform vec2 u_seed;
uniform float u_time;
uniform float u_angle;
uniform vec3 u_from;
uniform vec3 u_to;

float hash21(vec2 point) {
  vec3 mixed = fract(vec3(point.xyx) * vec3(0.1031, 0.1030, 0.0973));
  mixed += dot(mixed, mixed.yzx + 33.33);
  return fract((mixed.x + mixed.y) * mixed.z);
}

float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 offset = fract(point);
  vec2 curve = offset * offset * (3.0 - 2.0 * offset);
  float bottom = mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), curve.x);
  float top = mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), curve.x);
  return mix(bottom, top, curve.y);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 turn = mat2(0.80, 0.60, -0.60, 0.80);
  for (int octave = 0; octave < 4; octave += 1) {
    value += amplitude * noise(point);
    point = turn * point * 2.03 + vec2(17.17, 9.23);
    amplitude *= 0.50;
  }
  return value / 0.975;
}

vec3 oklabToSrgb(vec3 color) {
  float l = color.x + 0.3963377774 * color.y + 0.2158037573 * color.z;
  float m = color.x - 0.1055613458 * color.y - 0.0638541728 * color.z;
  float s = color.x - 0.0894841775 * color.y - 1.2914855480 * color.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  vec3 linearColor = vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
  vec3 low = linearColor * 12.92;
  vec3 high = 1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return clamp(mix(low, high, step(vec3(0.0031308), linearColor)), 0.0, 1.0);
}

vec3 darkColor() {
  return oklabToSrgb(u_from);
}

vec3 midColor() {
  return oklabToSrgb(mix(u_from, u_to, 0.48));
}

vec3 accentColor() {
  vec3 lab = vec3(clamp(u_to.x + 0.18, 0.0, 1.0), u_to.y * 0.78, u_to.z * 0.78);
  return oklabToSrgb(lab);
}

vec2 scenePoint() {
  float shortSide = max(1.0, min(u_resolution.x, u_resolution.y));
  vec2 point = (2.0 * gl_FragCoord.xy - u_resolution) / shortSide;
  float cosine = cos(u_angle);
  float sine = sin(u_angle);
  return mat2(cosine, -sine, sine, cosine) * point;
}
`;

const FLOW_SHADER = `
void main() {
  vec2 point = scenePoint() * vec2(0.76, 0.95);
  vec2 seedA = u_seed * 0.071;
  vec2 seedB = u_seed.yx * 0.093 + vec2(5.2, 1.3);
  float largeBend = fbm(vec2(point.x * 0.28 - u_time * 0.10, point.y * 0.48) + seedA);
  float crossBend = fbm(vec2(point.x * 0.16 + u_time * 0.035, point.y * 0.78) + seedB);
  float currentY = point.y + (largeBend - 0.5) * 0.92 + (crossBend - 0.5) * 0.32;
  float broadCurrent = fbm(vec2(point.x * 0.38 - u_time * 0.18, currentY * 1.35) + seedA * 0.57);
  float fastCurrent = fbm(vec2(point.x * 0.68 - u_time * 0.34, currentY * 3.20) + seedB * 0.43);
  float fineCurrent = fbm(vec2(
    point.x * 1.04 - u_time * 0.52,
    currentY * 5.40 + (fastCurrent - 0.5) * 0.58
  ) + seedA * 0.91);
  float microCurrent = noise(vec2(
    point.x * 1.72 - u_time * 0.76,
    currentY * 8.20 + (fineCurrent - 0.5) * 0.42
  ) + seedB * 0.68);
  float field = broadCurrent * 0.40 + fastCurrent * 0.34 + fineCurrent * 0.20 + microCurrent * 0.06;
  float blend = smoothstep(0.22, 0.78, field);
  blend = clamp(blend + (fineCurrent - 0.5) * 0.16 + (microCurrent - 0.5) * 0.05, 0.02, 0.98);
  float sheen = smoothstep(0.50, 0.76, fineCurrent) * smoothstep(0.30, 0.78, broadCurrent);
  vec3 color = oklabToSrgb(mix(u_from, u_to, blend));
  color = mix(color, accentColor(), sheen * 0.026);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const SMOKE_SHADER = `
uniform float u_density;
uniform float u_turbulence;
uniform float u_smoke_count;
uniform float u_smoke_spread;

float smokeSourcePosition(float slot, float aspect, float salt) {
  float jitter = hash21(u_seed * 0.131 + vec2(salt, slot * 9.17));
  float lanePosition = (slot + 0.5 + (jitter - 0.5) * 0.72) / max(1.0, u_smoke_count);
  return (lanePosition - 0.5) * aspect * 0.94;
}

float smokeSourceRandom(float salt) {
  return hash21(u_seed.yx * 0.173 + vec2(salt, salt * 1.71));
}

vec2 smokeCurl(vec2 point) {
  float epsilon = 0.065;
  float left = noise(point - vec2(epsilon, 0.0));
  float right = noise(point + vec2(epsilon, 0.0));
  float bottom = noise(point - vec2(0.0, epsilon));
  float top = noise(point + vec2(0.0, epsilon));
  vec2 gradient = vec2(right - left, top - bottom) / (2.0 * epsilon);
  vec2 curl = vec2(gradient.y, -gradient.x);
  return curl / (1.0 + length(curl));
}

float smokeTrail(vec2 point, float worldY, float origin, float phase, float size, float strength) {
  vec2 trailSeed = u_seed * 0.029 + vec2(phase * 0.37, phase * 0.19);
  vec2 advectedPoint = vec2(point.x, worldY);
  vec2 largeVortex = smokeCurl(
    advectedPoint * vec2(0.72, 0.61)
    + trailSeed
    + vec2(u_time * 0.031, -u_time * 0.019)
  );
  vec2 smallVortex = smokeCurl(
    advectedPoint * vec2(1.83, 1.57)
    + trailSeed.yx * 2.17
    + vec2(-u_time * 0.047, u_time * 0.029)
  );
  advectedPoint -= (
    largeVortex * 0.29
    + smallVortex * 0.105
  ) * (0.28 + u_turbulence * 0.72);

  float broadCurl = noise(vec2(advectedPoint.y * 0.31 + phase, phase * 0.13) + trailSeed) - 0.5;
  float smallCurl = noise(vec2(advectedPoint.y * 0.87 - phase * 0.21, phase * 0.47) + trailSeed.yx) - 0.5;
  float fineCurl = noise(vec2(advectedPoint.y * 2.09 + phase * 0.63, phase * 0.91) + trailSeed * 2.3) - 0.5;
  float center = origin + (
    broadCurl * 0.34
    + smallCurl * 0.14
    + fineCurl * 0.04
  ) * (0.36 + u_turbulence * 0.64);

  float widthNoise = noise(vec2(advectedPoint.y * 0.39 + phase * 0.73, phase * 0.31) + trailSeed * 1.7);
  float vortexExpansion = clamp(length(largeVortex) * 0.68 + length(smallVortex) * 0.32, 0.0, 1.0);
  float width = (0.062 + widthNoise * 0.105 + vortexExpansion * 0.035) * u_smoke_spread * size;
  float distanceToCore = abs(advectedPoint.x - center);
  float body = 1.0 - smoothstep(width * 0.24, width, distanceToCore);
  float rolledLobe = 1.0 - smoothstep(
    width * 0.18,
    width * 0.82,
    abs(advectedPoint.x - center - largeVortex.x * width * 1.65)
  );
  body = max(body, rolledLobe * (0.32 + vortexExpansion * 0.42));

  vec2 samplePoint = vec2(
    (advectedPoint.x - center) / max(width, 0.012),
    advectedPoint.y * 1.74 + phase
  );
  vec2 warp = vec2(
    fbm(samplePoint * 0.61 + trailSeed),
    fbm(samplePoint * 0.69 + trailSeed.yx + vec2(5.2, 1.7))
  ) - 0.5;
  float billow = fbm(samplePoint + warp * (0.72 + u_turbulence * 1.16));
  float filament = noise(samplePoint * (2.31 + u_turbulence * 1.04) + warp * 2.1 + trailSeed * 3.1);
  float texture = billow * 0.72 + filament * 0.28;
  float wisps = smoothstep(0.23, 0.68, texture);
  float rollingEdge = smoothstep(0.18, 0.82, vortexExpansion) * smoothstep(width * 0.18, width, distanceToCore);
  return body * clamp(wisps + rollingEdge * 0.16, 0.0, 1.0) * strength;
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 point = vec2((screenUv.x - 0.5) * aspect, screenUv.y);
  float worldY = screenUv.y - u_time * 0.29;

  float plumeDensity = 0.0;
  for (int sourceIndex = 0; sourceIndex < 6; sourceIndex += 1) {
    float slot = float(sourceIndex);
    if (slot + 0.5 > u_smoke_count) continue;
    float salt = 2.3 + slot * 7.1;
    float source = smokeTrail(
      point,
      worldY,
      smokeSourcePosition(slot, aspect, salt),
      smokeSourceRandom(salt + 1.4) * 37.0,
      0.72 + smokeSourceRandom(salt + 2.8) * 0.64,
      0.68 + smokeSourceRandom(salt + 4.1) * 0.32
    );
    plumeDensity = 1.0 - (1.0 - plumeDensity) * (1.0 - source);
  }

  vec2 veilPoint = vec2(point.x * 1.18, worldY * 1.82);
  float veilWarp = fbm(veilPoint * 0.62 + u_seed * 0.023) - 0.5;
  float veil = fbm(veilPoint + vec2(veilWarp * u_turbulence, 0.0) + u_seed.yx * 0.017);
  veil = smoothstep(0.51, 0.80, veil) * 0.20;

  float smoke = clamp((plumeDensity + veil) * u_density, 0.0, 1.0);
  float fineLight = noise(vec2(point.x * 4.1, worldY * 5.7) + u_seed * 0.07);
  float blend = smoothstep(0.035, 0.92, smoke);
  vec3 background = darkColor();
  vec3 smokeColor = oklabToSrgb(mix(u_from, u_to, 0.72 + fineLight * 0.22));
  vec3 color = mix(background, smokeColor, blend);
  color = mix(color, accentColor(), smoothstep(0.58, 0.96, smoke) * fineLight * 0.055);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const CELLS_SHADER = `
uniform float u_wall_thickness;

vec2 cellFeature(vec2 cell) {
  vec2 random = vec2(hash21(cell + u_seed), hash21(cell + u_seed + 19.17));
  return 0.5 + 0.36 * sin(u_time * 0.34 + random * 6.2831853);
}

void main() {
  vec2 point = scenePoint() * 3.15;
  vec2 cell = floor(point);
  vec2 local = fract(point);
  float nearest = 8.0;
  float second = 8.0;
  float identity = 0.0;
  for (int y = -1; y <= 1; y += 1) {
    for (int x = -1; x <= 1; x += 1) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 feature = neighbor + cellFeature(cell + neighbor);
      float distanceToFeature = length(feature - local);
      if (distanceToFeature < nearest) {
        second = nearest;
        nearest = distanceToFeature;
        identity = hash21(cell + neighbor + u_seed * 0.17);
      } else if (distanceToFeature < second) {
        second = distanceToFeature;
      }
    }
  }
  float boundary = 1.0 - smoothstep(0.015 * u_wall_thickness, 0.075 * u_wall_thickness, second - nearest);
  float core = 1.0 - smoothstep(0.0, 0.72, nearest);
  vec3 color = mix(darkColor(), midColor(), 0.06 + identity * 0.22 + core * 0.10);
  color += accentColor() * boundary * 0.18;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const EFFECT_SHADERS: Partial<Record<DynamicEffect, string>> = {
  flow: FLOW_SHADER,
  smoke: SMOKE_SHADER,
  cells: CELLS_SHADER
};

const EMPTY_PARAMETERS: NonNullable<DynamicBackgroundSettings["parameters"]> = Object.freeze({});

const FALLBACK_OKLAB_COLOR: [number, number, number] = [0, 0, 0];

function parseColorChannel(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 16);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(255, parsed));
}

function parseHexToLinearRgb(hex: string): [number, number, number] | null {
  const value = hex.trim();
  const source = value.startsWith("#") ? value.slice(1) : value;
  const normalized =
    source.length === 3
      ? source
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : source;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const red = parseColorChannel(normalized.slice(0, 2));
  const green = parseColorChannel(normalized.slice(2, 4));
  const blue = parseColorChannel(normalized.slice(4, 6));
  if (red === null || green === null || blue === null) return null;
  return [srgbToLinear(red), srgbToLinear(green), srgbToLinear(blue)];
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function hexToOklab(hex: string): [number, number, number] {
  const linear = parseHexToLinearRgb(hex) ?? parseHexToLinearRgb("#000000");
  if (!linear) return FALLBACK_OKLAB_COLOR;
  const [red, green, blue] = linear;
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

export function dynamicTimeScale(speed: number): number {
  const normalized = Math.max(0, Math.min(1, (speed - 10) / 10));
  return 0.54 + 1.67 * normalized ** 1.6;
}

export function resolveCellWallThickness(parameters: DynamicBackgroundSettings["parameters"]): number {
  const value = parameters?.wallThickness;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0.3, Math.min(2.5, value)) : 1;
}

export function resolveSmokeSettings(parameters: DynamicBackgroundSettings["parameters"]): {
  density: number;
  smokeCount: number;
  spread: number;
  turbulence: number;
} {
  const numberOr = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    density: Math.max(0.35, Math.min(1.5, numberOr(parameters?.density, 0.9))),
    smokeCount: Math.max(1, Math.min(6, Math.round(numberOr(parameters?.smokeCount, 4)))),
    spread: Math.max(0.5, Math.min(2, numberOr(parameters?.spread, 1))),
    turbulence: Math.max(0, Math.min(2, numberOr(parameters?.turbulence, 1)))
  };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error(`[DynamicBackground] ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader compilation failed:`, gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createRenderer(canvas: HTMLCanvasElement, effect: DynamicEffect): Renderer | null {
  const fragmentShader = EFFECT_SHADERS[effect];
  if (typeof fragmentShader !== "string") return null;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false
  });
  if (!gl) return null;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `${FRAGMENT_HEADER}\n${fragmentShader}`);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[DynamicBackground] shader program link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const position = gl.getAttribLocation(program, "a_position");
  if (position < 0) {
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return {
    buffer,
    gl,
    position,
    program,
    uniforms: {
      angle: gl.getUniformLocation(program, "u_angle"),
      density: gl.getUniformLocation(program, "u_density"),
      from: gl.getUniformLocation(program, "u_from"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      seed: gl.getUniformLocation(program, "u_seed"),
      smokeCount: gl.getUniformLocation(program, "u_smoke_count"),
      smokeSpread: gl.getUniformLocation(program, "u_smoke_spread"),
      time: gl.getUniformLocation(program, "u_time"),
      to: gl.getUniformLocation(program, "u_to"),
      turbulence: gl.getUniformLocation(program, "u_turbulence"),
      wallThickness: gl.getUniformLocation(program, "u_wall_thickness")
    }
  };
}

function destroyRenderer(renderer: Renderer | null): void {
  if (!renderer) return;
  renderer.gl.deleteBuffer(renderer.buffer);
  renderer.gl.deleteProgram(renderer.program);
}

function createSeed(): [number, number] {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    const fallback = Math.random() * 0xffffffff;
    return [(fallback / 0xffffffff) * 97, Math.random() * 97];
  }
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return [(values[0] / 0xffffffff) * 97, (values[1] / 0xffffffff) * 97];
}

function WebGlDynamicBackground({ background }: { background: ColorDynamicBackgroundSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seedRef = useRef<[number, number] | null>(null);
  if (!seedRef.current) seedRef.current = createSeed();
  const smokeSettings = resolveSmokeSettings(background.parameters);
  const frameConfigRef = useRef<FrameConfig>({
    angle: background.angle,
    density: smokeSettings.density,
    from: hexToOklab(background.from),
    smokeCount: smokeSettings.smokeCount,
    smokeSpread: smokeSettings.spread,
    speed: background.speed,
    to: hexToOklab(background.to),
    turbulence: smokeSettings.turbulence,
    wallThickness: resolveCellWallThickness(background.parameters)
  });
  frameConfigRef.current = {
    angle: background.angle,
    density: smokeSettings.density,
    from: hexToOklab(background.from),
    smokeCount: smokeSettings.smokeCount,
    smokeSpread: smokeSettings.spread,
    speed: background.speed,
    to: hexToOklab(background.to),
    turbulence: smokeSettings.turbulence,
    wallThickness: resolveCellWallThickness(background.parameters)
  };

  useEffect(() => {
    if (!EFFECT_SHADERS[background.effect]) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: Renderer | null = createRenderer(canvas, background.effect);
    let animationFrame: number | null = null;
    let elapsed = 0;
    let lastFrame: number | null = null;
    let disposed = false;

    const resize = () => {
      if (disposed || !renderer) return;
      const bounds = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, bounds.width || canvas.clientWidth || window.innerWidth);
      const cssHeight = Math.max(1, bounds.height || canvas.clientHeight || window.innerHeight);
      const nativeRatio = Math.max(1, window.devicePixelRatio || 1);
      const pixelBudget = background.effect === "smoke" ? 1_200_000 : 3_000_000;
      const pixelBudgetRatio = Math.sqrt(pixelBudget / Math.max(1, cssWidth * cssHeight));
      const maxViewport = renderer.gl.getParameter(renderer.gl.MAX_VIEWPORT_DIMS);
      const maxViewportWidth =
        typeof maxViewport === "object" && maxViewport !== null && 0 in maxViewport && 1 in maxViewport
          ? (maxViewport as ArrayLike<number>)[0]
          : window.innerWidth;
      const maxViewportHeight =
        typeof maxViewport === "object" && maxViewport !== null && 0 in maxViewport && 1 in maxViewport
          ? (maxViewport as ArrayLike<number>)[1]
          : window.innerHeight;
      const viewportRatio = Math.min(maxViewportWidth / cssWidth, maxViewportHeight / cssHeight);
      const qualityRatio = Math.max(0.5, Math.min(2, nativeRatio, pixelBudgetRatio));
      const pixelRatio = Math.max(0.1, Math.min(qualityRatio, viewportRatio));
      const width = Math.round(cssWidth * pixelRatio);
      const height = Math.round(cssHeight * pixelRatio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.gl.viewport(0, 0, width, height);
    };

    const schedule = () => {
      if (!disposed && animationFrame === null && document.visibilityState !== "hidden") {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const draw = (timestamp: number) => {
      animationFrame = null;
      if (disposed || !renderer || document.visibilityState === "hidden") return;
      const delta = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.05);
      lastFrame = timestamp;
      elapsed += delta * dynamicTimeScale(frameConfigRef.current.speed);

      const { gl, program, position, uniforms } = renderer;
      const config = frameConfigRef.current;
      const effectAngle = background.effect === "smoke" ? 0 : (config.angle * Math.PI) / 180;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform2f(uniforms.seed, seedRef.current![0], seedRef.current![1]);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform1f(uniforms.angle, effectAngle);
      gl.uniform3f(uniforms.from, config.from[0], config.from[1], config.from[2]);
      gl.uniform3f(uniforms.to, config.to[0], config.to[1], config.to[2]);
      gl.uniform1f(uniforms.density, config.density);
      gl.uniform1f(uniforms.smokeCount, config.smokeCount);
      gl.uniform1f(uniforms.smokeSpread, config.smokeSpread);
      gl.uniform1f(uniforms.turbulence, config.turbulence);
      gl.uniform1f(uniforms.wallThickness, config.wallThickness);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      schedule();
    };

    const handleVisibility = () => {
      lastFrame = null;
      if (document.visibilityState === "hidden" && animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      } else schedule();
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      if (renderer) destroyRenderer(renderer);
      renderer = null;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    };
    const handleContextRestored = () => {
      if (disposed) return;
      renderer = createRenderer(canvas, background.effect);
      lastFrame = null;
      resize();
      schedule();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    resize();
    schedule();
    return () => {
      disposed = true;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      destroyRenderer(renderer);
      renderer = null;
    };
  }, [background.effect]);

  return <canvas ref={canvasRef} className="dynamic-background" aria-hidden="true" />;
}

export function DynamicBackground({ background }: Props) {
  const parameters = background.parameters ?? EMPTY_PARAMETERS;
  if (background.effect === "neuroNoise") {
    return (
      <Suspense fallback={null}>
        <NeuroNoise className="dynamic-background" speed={background.speed} parameters={parameters} />
      </Suspense>
    );
  }

  const effectProps = {
    from: background.from,
    to: background.to,
    speed: background.speed,
    parameters
  };
  if (background.effect === "flash")
    return (
      <Suspense fallback={null}>
        <Flash className="dynamic-background" {...effectProps} />
      </Suspense>
    );
  if (background.effect === "silk")
    return (
      <Suspense fallback={null}>
        <SilkFlow className="dynamic-background" {...effectProps} />
      </Suspense>
    );
  if (background.effect === "dotGrid")
    return (
      <Suspense fallback={null}>
        <DotGrid className="dynamic-background dynamic-background-interactive" {...effectProps} />
      </Suspense>
    );
  if (background.effect === "lightPillar")
    return (
      <Suspense fallback={null}>
        <LightPillar className="dynamic-background" {...effectProps} />
      </Suspense>
    );
  if (background.effect === "galaxy")
    return (
      <Suspense fallback={null}>
        <Galaxy className="dynamic-background" {...effectProps} />
      </Suspense>
    );
  if (background.effect === "snow")
    return (
      <Suspense fallback={null}>
        <Snow className="dynamic-background" {...effectProps} />
      </Suspense>
    );
  return <WebGlDynamicBackground background={background} />;
}
