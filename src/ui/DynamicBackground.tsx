import { useEffect, useRef } from "react";
import type { Background } from "../shared/model";
import type { DynamicEffect } from "../shared/dynamicEffects";
import { Balatro } from "./backgrounds/Balatro";
import { DotGrid } from "./backgrounds/DotGrid";
import { Iridescence } from "./backgrounds/Iridescence";
import { LiquidChrome } from "./backgrounds/LiquidChrome";
import { MoltenMetal } from "./backgrounds/MoltenMetal";
import { NeuroNoise } from "./backgrounds/NeuroNoise";
import { Topography } from "./backgrounds/Topography";
import { WebThreads } from "./backgrounds/WebThreads";

type DynamicBackgroundSettings = Extract<Background, { type: "dynamic" }>;

interface Props {
  background: DynamicBackgroundSettings;
}

interface FrameConfig {
  angle: number;
  from: [number, number, number];
  speed: number;
  to: [number, number, number];
}

interface Renderer {
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  position: number;
  program: WebGLProgram;
  uniforms: {
    angle: WebGLUniformLocation | null;
    from: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    seed: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    to: WebGLUniformLocation | null;
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
  vec2 point = scenePoint() * vec2(0.72, 0.92);
  vec2 seedA = u_seed * 0.071;
  vec2 seedB = u_seed.yx * 0.093 + vec2(5.2, 1.3);
  vec2 domain = vec2(
    fbm(point * 0.72 + seedA + vec2(u_time * 0.12, u_time * 0.08)),
    fbm(point * 0.72 + seedB + vec2(-u_time * 0.09, u_time * 0.13))
  );
  vec2 warp = domain - 0.5;
  vec2 flowingPoint = point + 1.75 * warp;
  float broad = fbm(flowingPoint * 1.04 + seedB * 0.47 + vec2(u_time * 0.18, -u_time * 0.13));
  float current = fbm((point - 1.15 * warp.yx) * 0.58 + seedA * 0.63 + vec2(-u_time * 0.10, u_time * 0.15));
  float detail = noise(flowingPoint * 1.85 + seedA + vec2(u_time * 0.07, u_time * 0.11));
  float field = broad * 0.68 + current * 0.27 + detail * 0.05;
  float separated = clamp((field - 0.5) * 3.15 + 0.5, 0.0, 1.0);
  float blend = separated * separated * (3.0 - 2.0 * separated);
  gl_FragColor = vec4(oklabToSrgb(mix(u_from, u_to, blend)), 1.0);
}
`;

const AURORA_SHADER = `
float auroraRibbon(vec2 point, float level, float phase, float speed) {
  float wave = sin(point.x * (1.45 + level * 0.22) + u_time * speed + phase) * 0.16;
  wave += sin(point.x * 3.4 - u_time * speed * 0.47 + phase * 1.7) * 0.065;
  float grain = fbm(vec2(point.x * 1.25 + phase * 4.0, point.y * 0.52 + u_time * 0.035));
  float ridge = point.y - (0.12 + level * 0.22 + wave + (grain - 0.5) * 0.24);
  return exp(-abs(ridge) * (13.0 - level * 1.5));
}

void main() {
  vec2 point = scenePoint() * vec2(0.78, 0.70);
  float fade = smoothstep(-1.20, -0.10, point.y) * (1.0 - smoothstep(0.62, 1.12, point.y));
  float ribbonA = auroraRibbon(point, 0.0, 0.0, 0.12);
  float ribbonB = auroraRibbon(point, 1.0, 2.1, 0.095);
  float ribbonC = auroraRibbon(point, 2.0, 4.0, 0.075);
  float light = (ribbonA * 0.78 + ribbonB * 0.48 + ribbonC * 0.26) * fade;
  float haze = fbm(point * vec2(0.62, 0.35) + u_seed * 0.028 + vec2(u_time * 0.025, 0.0));
  vec3 color = mix(darkColor(), midColor(), 0.10 + haze * 0.10);
  color += accentColor() * light * 0.26;
  color += midColor() * light * 0.10;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const CELLS_SHADER = `
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
  float boundary = 1.0 - smoothstep(0.015, 0.075, second - nearest);
  float core = 1.0 - smoothstep(0.0, 0.72, nearest);
  vec3 color = mix(darkColor(), midColor(), 0.06 + identity * 0.22 + core * 0.10);
  color += accentColor() * boundary * 0.18;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const SNOW_SHADER = `
vec2 snowPoint() {
  float shortSide = max(1.0, min(u_resolution.x, u_resolution.y));
  return (2.0 * gl_FragCoord.xy - u_resolution) / shortSide;
}

float snowLayer(
  vec2 point,
  float scale,
  float fallSpeed,
  float wind,
  float radius,
  float opacity,
  float layer
) {
  vec2 grid = point * scale;
  // Every layer advances from the same speed-controlled clock. Layer speed is
  // applied once so changing the shared speed scales every flake consistently.
  float time = u_time;
  grid.x += time * wind;
  grid.x += sin(point.y * 1.7 + time * 0.55 + layer * 2.3) * (0.18 + abs(wind) * 0.45);
  grid.y += time * fallSpeed;

  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  float randomA = hash21(cell + u_seed + vec2(layer * 13.1, -layer * 7.7));
  float randomB = hash21(cell.yx + u_seed.yx + vec2(layer * 5.3, layer * 11.9));
  vec2 center = vec2(randomA, randomB) - 0.5;
  center *= 0.70;

  vec2 particle = local - center;
  particle.x += sin(u_time * (0.42 + randomB * 0.35) + randomA * 6.2831853) * 0.035;
  float distanceToParticle = length(particle);
  float pixel = 2.0 * scale / max(1.0, min(u_resolution.x, u_resolution.y));
  float particleRadius = max(radius * mix(0.72, 1.25, randomB), pixel * 1.15);
  float core = 1.0 - smoothstep(
    max(0.0, particleRadius - pixel * 0.85),
    particleRadius + pixel * 0.85,
    distanceToParticle
  );
  float halo = 1.0 - smoothstep(
    particleRadius,
    particleRadius * 2.8 + pixel,
    distanceToParticle
  );
  float presence = smoothstep(0.12, 0.30, hash21(cell + u_seed * 0.61 - vec2(layer)));
  float shimmer = 0.88 + 0.12 * sin(u_time * 0.55 + randomA * 6.2831853 + layer);
  return (core + halo * 0.18) * presence * opacity * shimmer;
}

void main() {
  vec2 point = snowPoint();
  float cloud = fbm(point * 0.48 + u_seed * 0.025 + vec2(u_time * 0.010, 0.0));
  float backgroundMix = clamp(0.06 + cloud * 0.18 + point.y * 0.025, 0.0, 1.0);
  vec3 base = oklabToSrgb(mix(u_from, u_to, backgroundMix));

  float backLayer = snowLayer(point, 15.0, 0.42, -0.10, 0.030, 0.24, 1.7);
  float midLayer = snowLayer(point, 9.5, 0.72, -0.16, 0.040, 0.48, 4.2);
  float frontLayer = snowLayer(point, 5.5, 1.08, -0.23, 0.055, 0.78, 9.3);
  float snow = max(0.0, backLayer + midLayer + frontLayer);
  float snowMask = 1.0 - exp(-snow * 1.35);
  vec3 snowColor = mix(vec3(0.94, 0.97, 1.0), oklabToSrgb(u_to), 0.12);
  float vignette = 1.0 - smoothstep(0.65, 1.75, length(point * vec2(0.54, 0.34)));
  vec3 color = mix(base, snowColor, snowMask * mix(0.78, 1.0, vignette));
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const EFFECT_SHADERS: Partial<Record<DynamicEffect, string>> = {
  flow: FLOW_SHADER,
  aurora: AURORA_SHADER,
  cells: CELLS_SHADER,
  snow: SNOW_SHADER
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
  const normalized = source.length === 3
    ? source.split("").map((character) => `${character}${character}`).join("")
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
      from: gl.getUniformLocation(program, "u_from"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      seed: gl.getUniformLocation(program, "u_seed"),
      time: gl.getUniformLocation(program, "u_time"),
      to: gl.getUniformLocation(program, "u_to")
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
    return [fallback / 0xffffffff * 97, Math.random() * 97];
  }
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return [values[0] / 0xffffffff * 97, values[1] / 0xffffffff * 97];
}

export function DynamicBackground({ background }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seedRef = useRef<[number, number] | null>(null);
  if (!seedRef.current) seedRef.current = createSeed();
  const frameConfigRef = useRef<FrameConfig>({
    angle: background.angle,
    from: hexToOklab(background.from),
    speed: background.speed,
    to: hexToOklab(background.to)
  });
  frameConfigRef.current = {
    angle: background.angle,
    from: hexToOklab(background.from),
    speed: background.speed,
    to: hexToOklab(background.to)
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
      const pixelBudgetRatio = Math.sqrt(3_000_000 / Math.max(1, cssWidth * cssHeight));
      const maxViewport = renderer.gl.getParameter(renderer.gl.MAX_VIEWPORT_DIMS);
      const maxViewportWidth = (typeof maxViewport === "object" && maxViewport !== null && 0 in maxViewport && 1 in maxViewport)
        ? (maxViewport as ArrayLike<number>)[0]
        : window.innerWidth;
      const maxViewportHeight = (typeof maxViewport === "object" && maxViewport !== null && 0 in maxViewport && 1 in maxViewport)
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
      const effectAngle = background.effect === "snow" ? 0.0 : config.angle * Math.PI / 180;
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

  const effectProps = {
    from: background.from,
    to: background.to,
    speed: background.speed,
    parameters: background.parameters ?? EMPTY_PARAMETERS
  } satisfies Pick<DynamicBackgroundSettings, "from" | "to" | "speed" | "parameters">;

  if (background.effect === "topography") return <Topography {...effectProps} />;
  if (background.effect === "webThreads") return <WebThreads {...effectProps} />;
  if (background.effect === "moltenMetal") return <MoltenMetal className="dynamic-background" {...effectProps} />;
  if (background.effect === "iridescence") return <Iridescence className="dynamic-background" {...effectProps} />;
  if (background.effect === "liquidChrome") return <LiquidChrome className="dynamic-background" {...effectProps} />;
  if (background.effect === "balatro") return <Balatro className="dynamic-background" {...effectProps} />;
  if (background.effect === "dotGrid") return <DotGrid className="dynamic-background dynamic-background-interactive" {...effectProps} />;
  if (background.effect === "neuroNoise") return <NeuroNoise className="dynamic-background" {...effectProps} />;

  return <canvas ref={canvasRef} className="dynamic-background" aria-hidden="true" />;
}
