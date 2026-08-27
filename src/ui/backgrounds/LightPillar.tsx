import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { LIGHT_PILLAR_DEFAULT_COLORS } from "../../shared/dynamicEffects";
import { boundedCanvasSize } from "./canvasSizing";

// Adapted from React Bits LightPillar by David Haz.
// See THIRD_PARTY_NOTICES.md for the applicable license and restriction.

export interface LightPillarParameters {
  rotation?: number;
  pillarWidth?: number;
  pillarHeight?: number;
}

export interface LightPillarSettings {
  rotation: number;
  pillarWidth: number;
  pillarHeight: number;
}

export interface LightPillarProps {
  className?: string;
  from?: string;
  to?: string;
  speed?: number;
  parameters?: LightPillarParameters;
}

interface RuntimeSettings extends LightPillarSettings {
  bottomColor: [number, number, number];
  speed: number;
  topColor: [number, number, number];
}

interface QualitySettings {
  iterations: number;
  pixelRatio: number;
  precision: "highp" | "mediump";
  stepMultiplier: number;
  targetFps: number;
  waveIterations: number;
}

interface Renderer {
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  position: number;
  program: WebGLProgram;
  uniforms: {
    bottomColor: WebGLUniformLocation | null;
    pillarHeight: WebGLUniformLocation | null;
    pillarRotCos: WebGLUniformLocation | null;
    pillarRotSin: WebGLUniformLocation | null;
    pillarWidth: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    rotCos: WebGLUniformLocation | null;
    rotSin: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    topColor: WebGLUniformLocation | null;
  };
}

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 vUv;

void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

function fragmentShader(settings: QualitySettings): string {
  return `
precision ${settings.precision} float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uTopColor;
uniform vec3 uBottomColor;
uniform float uPillarWidth;
uniform float uPillarHeight;
uniform float uRotCos;
uniform float uRotSin;
uniform float uPillarRotCos;
uniform float uPillarRotSin;
varying vec2 vUv;

const float STEP_MULT = ${settings.stepMultiplier.toFixed(1)};
const int MAX_ITER = ${settings.iterations};
const int WAVE_ITER = ${settings.waveIterations};
const float GLOW_AMOUNT = 0.005;
const float NOISE_INTENSITY = 0.5;

void main() {
  vec2 uv = (vUv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0);
  uv = vec2(
    uPillarRotCos * uv.x - uPillarRotSin * uv.y,
    uPillarRotSin * uv.x + uPillarRotCos * uv.y
  );

  vec3 rayOrigin = vec3(0.0, 0.0, -10.0);
  vec3 rayDirection = normalize(vec3(uv, 1.0));
  vec3 color = vec3(0.0);
  float distanceTravelled = 0.1;
  float waveSin = sin(0.4);
  float waveCos = cos(0.4);

  for (int stepIndex = 0; stepIndex < MAX_ITER; stepIndex++) {
    vec3 point = rayOrigin + rayDirection * distanceTravelled;
    point.xz = vec2(
      uRotCos * point.x - uRotSin * point.z,
      uRotSin * point.x + uRotCos * point.z
    );

    vec3 wavePoint = point;
    wavePoint.y = point.y * uPillarHeight + uTime;
    float frequency = 1.0;
    float amplitude = 1.0;

    for (int waveIndex = 0; waveIndex < WAVE_ITER; waveIndex++) {
      wavePoint.xz = vec2(
        waveCos * wavePoint.x - waveSin * wavePoint.z,
        waveSin * wavePoint.x + waveCos * wavePoint.z
      );
      wavePoint += cos(wavePoint.zxy * frequency - uTime * float(waveIndex) * 2.0) * amplitude;
      frequency *= 2.0;
      amplitude *= 0.5;
    }

    float fieldDistance = length(cos(wavePoint.xz)) - 0.2;
    float pillarBounds = length(point.xz) - uPillarWidth;
    float smoothing = 4.0;
    float blend = max(smoothing - abs(fieldDistance - pillarBounds), 0.0);
    fieldDistance = max(fieldDistance, pillarBounds) + blend * blend * 0.0625 / smoothing;
    fieldDistance = abs(fieldDistance) * 0.15 + 0.01;

    float gradient = clamp((15.0 - point.y) / 30.0, 0.0, 1.0);
    color += mix(uBottomColor, uTopColor, gradient) / fieldDistance;
    distanceTravelled += fieldDistance * STEP_MULT;
    if (distanceTravelled > 50.0) break;
  }

  float normalizedWidth = uPillarWidth / 3.0;
  vec3 glow = max(color * GLOW_AMOUNT / normalizedWidth, vec3(0.0));
  vec3 glowDecay = exp(-2.0 * min(glow, vec3(20.0)));
  color = (vec3(1.0) - glowDecay) / (vec3(1.0) + glowDecay);
  color -= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 15.0 * NOISE_INTENSITY;
  gl_FragColor = vec4(color, 1.0);
}
`;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function numericValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveLightPillarSettings(parameters: LightPillarParameters = {}): LightPillarSettings {
  return {
    rotation: clampValue(numericValue(parameters.rotation, 0), -180, 180),
    pillarWidth: clampValue(numericValue(parameters.pillarWidth, 8), 0.5, 12),
    pillarHeight: clampValue(numericValue(parameters.pillarHeight, 0.4), 0.1, 2)
  };
}

function colorChannelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function lightPillarColor(hex: string, fallback: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  return [
    colorChannelToLinear(Number.parseInt(value.slice(1, 3), 16)),
    colorChannelToLinear(Number.parseInt(value.slice(3, 5), 16)),
    colorChannelToLinear(Number.parseInt(value.slice(5, 7), 16))
  ];
}

function qualitySettings(): QualitySettings {
  const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const lowEnd = mobile || (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4);
  if (mobile) return { iterations: 24, waveIterations: 1, pixelRatio: 0.5, precision: "mediump", stepMultiplier: 1.5, targetFps: 30 };
  if (lowEnd) return { iterations: 40, waveIterations: 2, pixelRatio: 0.65, precision: "mediump", stepMultiplier: 1.2, targetFps: 60 };
  return { iterations: 80, waveIterations: 4, pixelRatio: 2, precision: "highp", stepMultiplier: 1, targetFps: 60 };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error("[LightPillar] shader compilation failed:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createRenderer(canvas: HTMLCanvasElement, quality: QualitySettings): Renderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: quality.precision === "highp" ? "high-performance" : "low-power",
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false
  });
  if (!gl) return null;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader(quality));
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
    console.error("[LightPillar] shader link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const position = gl.getAttribLocation(program, "a_position");
  const buffer = gl.createBuffer();
  if (position < 0 || !buffer) {
    if (buffer) gl.deleteBuffer(buffer);
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
      bottomColor: gl.getUniformLocation(program, "uBottomColor"),
      pillarHeight: gl.getUniformLocation(program, "uPillarHeight"),
      pillarRotCos: gl.getUniformLocation(program, "uPillarRotCos"),
      pillarRotSin: gl.getUniformLocation(program, "uPillarRotSin"),
      pillarWidth: gl.getUniformLocation(program, "uPillarWidth"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      rotCos: gl.getUniformLocation(program, "uRotCos"),
      rotSin: gl.getUniformLocation(program, "uRotSin"),
      time: gl.getUniformLocation(program, "uTime"),
      topColor: gl.getUniformLocation(program, "uTopColor")
    }
  };
}

function destroyRenderer(renderer: Renderer | null): void {
  if (!renderer) return;
  renderer.gl.deleteBuffer(renderer.buffer);
  renderer.gl.deleteProgram(renderer.program);
}

export function LightPillar({
  className = "dynamic-background",
  from = LIGHT_PILLAR_DEFAULT_COLORS.top,
  to = LIGHT_PILLAR_DEFAULT_COLORS.bottom,
  speed = 0.3,
  parameters
}: LightPillarProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resolved = resolveLightPillarSettings(parameters);
  const runtimeRef = useRef<RuntimeSettings>({
    ...resolved,
    bottomColor: lightPillarColor(to, LIGHT_PILLAR_DEFAULT_COLORS.bottom),
    speed: clampValue(numericValue(speed, 0.3), 0.05, 2),
    topColor: lightPillarColor(from, LIGHT_PILLAR_DEFAULT_COLORS.top)
  });
  runtimeRef.current = {
    ...resolved,
    bottomColor: lightPillarColor(to, LIGHT_PILLAR_DEFAULT_COLORS.bottom),
    speed: clampValue(numericValue(speed, 0.3), 0.05, 2),
    topColor: lightPillarColor(from, LIGHT_PILLAR_DEFAULT_COLORS.top)
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const quality = qualitySettings();
    let renderer = createRenderer(canvas, quality);
    let animationFrame: number | null = null;
    let elapsed = 0;
    let lastFrame: number | null = null;
    let disposed = false;

    const resize = () => {
      if (disposed || !renderer) return;
      const bounds = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, bounds.width || canvas.clientWidth || window.innerWidth);
      const cssHeight = Math.max(1, bounds.height || canvas.clientHeight || window.innerHeight);
      const bounded = boundedCanvasSize(cssWidth, cssHeight);
      const dpr = Math.min(bounded.dpr, quality.pixelRatio);
      const width = Math.max(1, Math.floor(cssWidth * dpr));
      const height = Math.max(1, Math.floor(cssHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.gl.viewport(0, 0, width, height);
    };

    const schedule = () => {
      if (!disposed && renderer && animationFrame === null && document.visibilityState !== "hidden") {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const draw = (timestamp: number) => {
      animationFrame = null;
      if (disposed || !renderer || document.visibilityState === "hidden") return;
      const minimumFrameTime = 1000 / quality.targetFps;
      if (lastFrame !== null && timestamp - lastFrame < minimumFrameTime) {
        schedule();
        return;
      }
      const delta = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.05);
      lastFrame = timestamp;
      const settings = runtimeRef.current;
      elapsed += delta * settings.speed;
      const rotation = settings.rotation * Math.PI / 180;
      const automaticRotation = elapsed * 0.3;
      const { gl, program, position, uniforms } = renderer;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform3f(uniforms.topColor, settings.topColor[0], settings.topColor[1], settings.topColor[2]);
      gl.uniform3f(uniforms.bottomColor, settings.bottomColor[0], settings.bottomColor[1], settings.bottomColor[2]);
      gl.uniform1f(uniforms.pillarWidth, settings.pillarWidth);
      gl.uniform1f(uniforms.pillarHeight, settings.pillarHeight);
      gl.uniform1f(uniforms.rotCos, Math.cos(automaticRotation));
      gl.uniform1f(uniforms.rotSin, Math.sin(automaticRotation));
      gl.uniform1f(uniforms.pillarRotCos, Math.cos(rotation));
      gl.uniform1f(uniforms.pillarRotSin, Math.sin(rotation));
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
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      destroyRenderer(renderer);
      renderer = null;
    };
    const handleContextRestored = () => {
      if (disposed) return;
      renderer = createRenderer(canvas, quality);
      lastFrame = null;
      resize();
      schedule();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibility);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    resize();
    schedule();
    return () => {
      disposed = true;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      destroyRenderer(renderer);
      renderer = null;
    };
  }, []);

  const style: CSSProperties = { mixBlendMode: "screen" };
  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" />;
}

export default LightPillar;
