import { type ReactElement, useEffect, useRef } from "react";
import type { DynamicEffectParameters } from "../../shared/dynamicEffects";

type Color = readonly [number, number, number];
type ColorMode = "elevation" | "uniform" | "alternating";

interface TopographyProps {
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DynamicEffectParameters;
  className?: string;
}

export interface TopographySettings {
  colors: { low: Color; mid: Color; high: Color };
  speed: number;
  morphAmount: number;
  morphSpeed: number;
  bands: number;
  thickness: number;
  scale: number;
  pixelSize: number;
  glow: number;
  colorMode: ColorMode;
  contrast: number;
  brightness: number;
  fillBands: boolean;
  opacity: number;
  grain: boolean;
  grainIntensity: number;
  mouseInteraction: boolean;
  mouseRadius: number;
  mouseStrength: number;
}

interface Uniforms {
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  morphAmount: WebGLUniformLocation | null;
  bands: WebGLUniformLocation | null;
  thickness: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  pixelSize: WebGLUniformLocation | null;
  glow: WebGLUniformLocation | null;
  colorMode: WebGLUniformLocation | null;
  contrast: WebGLUniformLocation | null;
  brightness: WebGLUniformLocation | null;
  fillBands: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  grain: WebGLUniformLocation | null;
  grainIntensity: WebGLUniformLocation | null;
  low: WebGLUniformLocation | null;
  mid: WebGLUniformLocation | null;
  high: WebGLUniformLocation | null;
  mouse: WebGLUniformLocation | null;
  mouseEnabled: WebGLUniformLocation | null;
  mouseRadius: WebGLUniformLocation | null;
  mouseStrength: WebGLUniformLocation | null;
  mouseActive: WebGLUniformLocation | null;
  controls: readonly [
    WebGLUniformLocation | null,
    WebGLUniformLocation | null,
    WebGLUniformLocation | null,
    WebGLUniformLocation | null
  ];
}

interface RendererState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  uniforms: Uniforms;
}

const DEFAULTS = {
  speed: 0.35,
  morphAmount: 3,
  morphSpeed: 0.05,
  bands: 2,
  thickness: 0.01,
  scale: 1,
  pixelSize: 1,
  glow: 0.5,
  contrast: 3,
  brightness: 1,
  opacity: 1,
  grainIntensity: 0.05,
  mouseRadius: 0.3,
  mouseStrength: 0.4
} as const;

const CONTROL_INDICES = [
  [1, -2, 3, -4],
  [9, -8, 7, -6],
  [5, 2, 5, -5],
  [-1, -3, 8, 9]
] as const;

const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute vec2 aUv;
varying vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// This is the ReactBits Topography field/contour algorithm adapted to WebGL 1.
// The small resolution-based antialias width avoids relying on shader extensions.
const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform vec2 iResolution;
uniform float iTime;
uniform float uMorphAmount;
uniform float uBands;
uniform float uThickness;
uniform float uScale;
uniform float uPixelSize;
uniform float uGlow;
uniform float uColorMode;
uniform float uContrast;
uniform float uBrightness;
uniform float uFillBands;
uniform float uOpacity;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec2 uMouse;
uniform float uMouseEnabled;
uniform float uMouseRadius;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform vec4 uCtrlA;
uniform vec4 uCtrlB;
uniform vec4 uCtrlC;
uniform vec4 uCtrlD;

float bez(float t, vec4 control) {
  float wave = 6.2831853 * t;
  return 0.5 * (
    control.x * sin(wave) +
    control.y * cos(wave) +
    control.z * sin(2.0 * wave) +
    control.w * cos(2.0 * wave)
  );
}

float field(vec2 uv) {
  vec2 a = vec2(bez(uv.x, uCtrlA), bez(uv.x, uCtrlB));
  vec2 b = vec2(bez(uv.y, uCtrlC), bez(uv.y, uCtrlD));
  return distance(a, b);
}

vec3 elevationColor(float elevation) {
  vec3 color = mix(uLow, uMid, smoothstep(0.0, 0.5, elevation));
  return mix(color, uHigh, smoothstep(0.5, 1.0, elevation));
}

void main() {
  vec2 resolution = max(iResolution, vec2(1.0));
  vec2 uv = vUv;
  vec2 scaledUv = (uv - 0.5) / max(uScale, 0.001) + 0.5;
  vec2 sampleUv = scaledUv;

  if (uPixelSize > 1.0) {
    vec2 pixelGrid = max(vec2(1.0), resolution / uPixelSize);
    sampleUv = (floor(scaledUv * pixelGrid) + 0.5) / pixelGrid;
  }

  float fieldValue = field(sampleUv);
  if (uMouseEnabled > 0.5) {
    vec2 delta = uv - uMouse;
    delta.x *= resolution.x / max(resolution.y, 1.0);
    float radius = max(uMouseRadius, 0.001);
    fieldValue += exp(-dot(delta, delta) / (radius * radius)) * uMouseStrength * uMouseActive;
  }

  float contourValue = fieldValue * uBands;
  float contourFraction = fract(contourValue);
  float lineDistance = min(contourFraction, 1.0 - contourFraction);
  float antiAlias = max(0.00075, uBands * 1.25 / max(min(resolution.x, resolution.y), 1.0));
  float line = 1.0 - smoothstep(max(0.0, uThickness - antiAlias), uThickness + antiAlias, lineDistance);
  float glowRadius = uThickness + uGlow * 0.5 + antiAlias;
  float glow = (1.0 - smoothstep(uThickness, glowRadius, lineDistance)) * step(0.0001, uGlow);

  float elevation = clamp(fieldValue / (uMorphAmount * 2.5 + 0.001), 0.0, 1.0);
  vec3 lineColor;
  if (uColorMode < 0.5) {
    lineColor = elevationColor(elevation);
  } else if (uColorMode < 1.5) {
    lineColor = uMid;
  } else {
    lineColor = mix(uMid, uHigh, mod(floor(contourValue), 2.0));
  }

  float coverage = pow(clamp(line + glow * 0.55, 0.0, 1.0), max(uContrast, 0.001));
  vec3 outputColor = lineColor;
  float outputAlpha = coverage;
  if (uFillBands > 0.5) {
    vec3 fillColor = elevationColor(elevation);
    outputColor = mix(fillColor, lineColor, coverage);
    outputAlpha = clamp(coverage + 0.1 * elevation, 0.0, 1.0);
  }

  if (uGrain > 0.5) {
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
    outputAlpha += (grain - 0.5) * uGrainIntensity;
  }

  outputColor = clamp(outputColor * uBrightness, 0.0, 1.0);
  float alpha = clamp(outputAlpha, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(outputColor * alpha, alpha);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function numberParameter(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function booleanParameter(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseColor(value: string | undefined, fallback: Color): Color {
  const source = value?.replace(/^#/, "") ?? "";
  const normalized = source.length === 3
    ? source.split("").map((character) => `${character}${character}`).join("")
    : source;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
  const parsed = Number.parseInt(normalized, 16);
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255
  ];
}

function mix(left: Color, right: Color, amount: number): Color {
  return [
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount
  ];
}

function resolveColorMode(value: unknown): ColorMode {
  return value === "uniform" || value === "alternating" ? value : "elevation";
}

export function resolveTopographySettings({ from, to, speed, parameters = {} }: TopographyProps): TopographySettings {
  const low = parseColor(from, [0.32, 0.15, 1]);
  const high = parseColor(to, [1, 0.62, 0.99]);
  const mid = parseColor(typeof parameters.color3 === "string" ? parameters.color3 : undefined, mix(low, high, 0.5));

  return {
    colors: { low, mid, high },
    speed: numberParameter(speed, DEFAULTS.speed, 0, 2),
    morphAmount: numberParameter(parameters.morphAmount, DEFAULTS.morphAmount, 0.5, 6),
    morphSpeed: numberParameter(parameters.morphSpeed, DEFAULTS.morphSpeed, 0.01, 0.2),
    bands: numberParameter(parameters.bands, DEFAULTS.bands, 1, 8),
    thickness: numberParameter(parameters.thickness, DEFAULTS.thickness, 0.01, 0.25),
    scale: numberParameter(parameters.scale, DEFAULTS.scale, 0.3, 3),
    pixelSize: numberParameter(parameters.pixelSize, DEFAULTS.pixelSize, 1, 40),
    glow: numberParameter(parameters.glow, DEFAULTS.glow, 0, 1.2),
    colorMode: resolveColorMode(parameters.colorMode),
    contrast: numberParameter(parameters.contrast, DEFAULTS.contrast, 1, 3),
    brightness: numberParameter(parameters.brightness, DEFAULTS.brightness, 0.4, 1.6),
    fillBands: booleanParameter(parameters.fillBands, false),
    opacity: numberParameter(parameters.opacity, DEFAULTS.opacity, 0, 1),
    grain: booleanParameter(parameters.grain, true),
    grainIntensity: numberParameter(parameters.grainIntensity, DEFAULTS.grainIntensity, 0, 0.3),
    mouseInteraction: booleanParameter(parameters.mouseInteraction, true),
    mouseRadius: numberParameter(parameters.mouseRadius, DEFAULTS.mouseRadius, 0.05, 1),
    mouseStrength: numberParameter(parameters.mouseStrength, DEFAULTS.mouseStrength, 0, 1.5)
  };
}

function colorModeValue(mode: ColorMode): number {
  if (mode === "uniform") return 1;
  if (mode === "alternating") return 2;
  return 0;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Topography shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Topography shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Topography program allocation failed");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Topography program linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function getUniforms(gl: WebGLRenderingContext, program: WebGLProgram): Uniforms {
  const location = (name: string) => gl.getUniformLocation(program, name);
  return {
    resolution: location("iResolution"),
    time: location("iTime"),
    morphAmount: location("uMorphAmount"),
    bands: location("uBands"),
    thickness: location("uThickness"),
    scale: location("uScale"),
    pixelSize: location("uPixelSize"),
    glow: location("uGlow"),
    colorMode: location("uColorMode"),
    contrast: location("uContrast"),
    brightness: location("uBrightness"),
    fillBands: location("uFillBands"),
    opacity: location("uOpacity"),
    grain: location("uGrain"),
    grainIntensity: location("uGrainIntensity"),
    low: location("uLow"),
    mid: location("uMid"),
    high: location("uHigh"),
    mouse: location("uMouse"),
    mouseEnabled: location("uMouseEnabled"),
    mouseRadius: location("uMouseRadius"),
    mouseStrength: location("uMouseStrength"),
    mouseActive: location("uMouseActive"),
    controls: [location("uCtrlA"), location("uCtrlB"), location("uCtrlC"), location("uCtrlD")]
  };
}

function uploadSettings({ gl, program, uniforms }: RendererState, settings: TopographySettings): void {
  const set1f = (location: WebGLUniformLocation | null, value: number) => {
    if (location !== null) gl.uniform1f(location, value);
  };
  const set3f = (location: WebGLUniformLocation | null, color: Color) => {
    if (location !== null) gl.uniform3f(location, color[0], color[1], color[2]);
  };
  gl.useProgram(program);
  set1f(uniforms.morphAmount, settings.morphAmount);
  set1f(uniforms.bands, settings.bands);
  set1f(uniforms.thickness, settings.thickness);
  set1f(uniforms.scale, settings.scale);
  set1f(uniforms.pixelSize, settings.pixelSize);
  set1f(uniforms.glow, settings.glow);
  set1f(uniforms.colorMode, colorModeValue(settings.colorMode));
  set1f(uniforms.contrast, settings.contrast);
  set1f(uniforms.brightness, settings.brightness);
  set1f(uniforms.fillBands, settings.fillBands ? 1 : 0);
  set1f(uniforms.opacity, settings.opacity);
  set1f(uniforms.grain, settings.grain ? 1 : 0);
  set1f(uniforms.grainIntensity, settings.grainIntensity);
  set1f(uniforms.mouseEnabled, settings.mouseInteraction ? 1 : 0);
  set1f(uniforms.mouseRadius, settings.mouseRadius);
  set1f(uniforms.mouseStrength, settings.mouseStrength);
  set3f(uniforms.low, settings.colors.low);
  set3f(uniforms.mid, settings.colors.mid);
  set3f(uniforms.high, settings.colors.high);
}

export function Topography({ className = "dynamic-background", ...props }: TopographyProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RendererState | null>(null);
  const settingsRef = useRef(resolveTopographySettings(props));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "low-power"
    });
    if (!gl) return;

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let frameId = 0;
    let disposed = false;
    let pageVisible = document.visibilityState !== "hidden";
    const startTime = performance.now();
    const currentMouse = [0.5, 0.5];
    const targetMouse = [0.5, 0.5];
    let mouseActive = 0;
    let targetMouseActive = 0;
    const controlValues = CONTROL_INDICES.map(() => new Float32Array(4));

    try {
      program = createProgram(gl);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error("Topography geometry allocation failed");
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        -1, 1, 0, 1,
        1, 1, 1, 1
      ]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      const uv = gl.getAttribLocation(program, "aUv");
      if (position < 0 || uv < 0) throw new Error("Topography attributes unavailable");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    } catch (error) {
      console.error("Topography initialization failed", error);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      return;
    }

    const uniforms = getUniforms(gl, program);
    const renderer = { gl, program, uniforms };
    rendererRef.current = renderer;
    gl.clearColor(0, 0, 0, 0);
    uploadSettings(renderer, settingsRef.current);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, bounds.width || window.innerWidth);
      const cssHeight = Math.max(1, bounds.height || window.innerHeight);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      if (uniforms.resolution !== null) gl.uniform2f(uniforms.resolution, width, height);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!settingsRef.current.mouseInteraction) return;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      targetMouse[0] = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
      targetMouse[1] = clamp(1 - (event.clientY - bounds.top) / bounds.height, 0, 1);
      targetMouseActive = 1;
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) targetMouseActive = 0;
    };
    const onBlur = () => { targetMouseActive = 0; };

    const schedule = () => {
      if (!disposed && pageVisible && frameId === 0) frameId = requestAnimationFrame(render);
    };
    const render = (timestamp: number) => {
      frameId = 0;
      if (disposed || !pageVisible) return;
      const settings = settingsRef.current;
      const elapsed = Math.max(0, timestamp - startTime) * 0.001;

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (uniforms.time !== null) gl.uniform1f(uniforms.time, elapsed);
      for (let group = 0; group < CONTROL_INDICES.length; group += 1) {
        const values = controlValues[group];
        for (let item = 0; item < 4; item += 1) {
          const index = CONTROL_INDICES[group][item];
          values[item] = settings.morphAmount * Math.sin(elapsed * settings.speed * Math.sin(index * settings.morphSpeed) + index);
        }
        const location = uniforms.controls[group];
        if (location !== null) gl.uniform4fv(location, values);
      }

      currentMouse[0] += 0.08 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.08 * (targetMouse[1] - currentMouse[1]);
      mouseActive += 0.08 * (targetMouseActive - mouseActive);
      if (uniforms.mouse !== null) gl.uniform2f(uniforms.mouse, currentMouse[0], currentMouse[1]);
      if (uniforms.mouseActive !== null) gl.uniform1f(uniforms.mouseActive, mouseActive);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      schedule();
    };

    const onVisibilityChange = () => {
      pageVisible = document.visibilityState !== "hidden";
      if (!pageVisible && frameId !== 0) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      } else {
        schedule();
      }
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resizeObserver?.observe(canvas);
    if (!resizeObserver) window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerOut, { passive: true });
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    resize();
    schedule();

    return () => {
      disposed = true;
      if (frameId !== 0) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      if (rendererRef.current?.program === program) rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const settings = resolveTopographySettings(props);
    settingsRef.current = settings;
    if (rendererRef.current) uploadSettings(rendererRef.current, settings);
  }, [props.from, props.to, props.speed, props.parameters]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default Topography;
