import { type ReactElement, useEffect, useRef } from "react";

type DynamicEffectParameterValue = string | number | boolean;
type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;
type Color = [number, number, number];
type WebGLContext = WebGLRenderingContext;

type FanMode = "center" | "left" | "right";
type Uniforms = {
  iResolution: WebGLUniformLocation | null;
  iTime: WebGLUniformLocation | null;
  uSpeed: WebGLUniformLocation | null;
  uThreadCount: WebGLUniformLocation | null;
  uFrequency: WebGLUniformLocation | null;
  uSpread: WebGLUniformLocation | null;
  uTaper: WebGLUniformLocation | null;
  uPosition: WebGLUniformLocation | null;
  uFanMode: WebGLUniformLocation | null;
  uGlow: WebGLUniformLocation | null;
  uFalloff: WebGLUniformLocation | null;
  uThickness: WebGLUniformLocation | null;
  uBrightness: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
  uMirror: WebGLUniformLocation | null;
  uShimmer: WebGLUniformLocation | null;
  uGrain: WebGLUniformLocation | null;
  uGrainIntensity: WebGLUniformLocation | null;
  uColor1: WebGLUniformLocation | null;
  uColor2: WebGLUniformLocation | null;
  uColor3: WebGLUniformLocation | null;
  uMouse: WebGLUniformLocation | null;
  uMouseStrength: WebGLUniformLocation | null;
  uEnableMouse: WebGLUniformLocation | null;
  uMouseActive: WebGLUniformLocation | null;
};

export const WEBTHREADS_DEFAULTS = {
  from: "#5227FF",
  to: "#FF9FFC",
  speed: 0.2,
  parameters: {
    threadCount: 6,
    frequency: 5.0,
    spread: 0.18,
    taper: 1.0,
    position: 0.5,
    fanMode: "center" as FanMode,
    glow: 0.02,
    falloff: 0.6,
    thickness: 1.1,
    brightness: 0.6,
    opacity: 1.0,
    mirror: true,
    shimmer: false,
    grain: true,
    grainIntensity: 0.05,
    mouseStrength: 0.3
  },
  mouseInteraction: true
} as const;

export const WEBTHREADS_RANGES = {
  speed: { min: 0, max: 2, step: 0.05 },
  threadCount: { min: 1, max: 10, step: 1 },
  frequency: { min: 1, max: 14, step: 0.5 },
  spread: { min: 0, max: 0.6, step: 0.01 },
  taper: { min: 0, max: 3, step: 0.05 },
  position: { min: 0, max: 1, step: 0.01 },
  glow: { min: 0, max: 0.06, step: 0.001 },
  falloff: { min: 0.3, max: 1.2, step: 0.01 },
  thickness: { min: 0.3, max: 3, step: 0.05 },
  brightness: { min: 0, max: 2.5, step: 0.05 },
  opacity: { min: 0, max: 1, step: 0.01 },
  grainIntensity: { min: 0, max: 0.3, step: 0.01 },
  mouseStrength: { min: 0, max: 1, step: 0.01 }
} as const;

interface WebThreadsProps {
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DynamicEffectParameters;
}

interface WebThreadsSettings {
  speed: number;
  threadCount: number;
  frequency: number;
  spread: number;
  taper: number;
  position: number;
  fanMode: FanMode;
  glow: number;
  falloff: number;
  thickness: number;
  brightness: number;
  opacity: number;
  mirror: boolean;
  shimmer: boolean;
  grain: boolean;
  grainIntensity: number;
  mouseInteraction: boolean;
  mouseStrength: number;
  colors: {
    color1: Color;
    color2: Color;
    color3: Color;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseColor(value: string | undefined, fallback: string): Color {
  const source = (value ?? fallback).trim();
  const raw = source[0] === "#" ? source.slice(1) : source;
  const normalized = raw.length === 3
    ? raw.split("").map((character) => `${character}${character}`).join("")
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    const fallbackBody = fallback[0] === "#" ? fallback.slice(1) : fallback;
    const next = fallbackBody.length === 3
      ? fallbackBody.split("").map((character) => `${character}${character}`).join("")
      : fallbackBody;
    const parsed = Number.parseInt(next, 16);
    return [
      ((parsed >> 16) & 255) / 255,
      ((parsed >> 8) & 255) / 255,
      (parsed & 255) / 255
    ];
  }
  const parsed = Number.parseInt(normalized, 16);
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255
  ];
}

function getNumber(value: DynamicEffectParameterValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: DynamicEffectParameterValue | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getString(value: DynamicEffectParameterValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mapSharedSpeed(value: number, fallback: number, max: number): number {
  if (value > 5 && value <= 20) {
    const normalized = clamp((value - 10) / 10, 0, 1);
    return clamp(fallback * (0.54 + 1.67 * normalized ** 1.6), 0, max);
  }
  return clamp(value, 0, max);
}

function mix(a: Color, b: Color, t: number): Color {
  return [
    clamp(a[0] + (b[0] - a[0]) * t, 0, 1),
    clamp(a[1] + (b[1] - a[1]) * t, 0, 1),
    clamp(a[2] + (b[2] - a[2]) * t, 0, 1)
  ];
}

function parseFanMode(value: string | undefined): FanMode {
  if (value === "left" || value === "right") return value;
  return "center";
}

function deriveColors(from: Color, to: Color): { color1: Color; color2: Color; color3: Color } {
  const color1 = from;
  const color2 = to;
  const color3 = mix(to, [1, 1, 1], 0.85);
  return { color1, color2, color3 };
}

function resolveSettings(props: WebThreadsProps): WebThreadsSettings {
  const params = props.parameters ?? {};
  const rawSpeed = getNumber(
    getNumber(props.speed, getNumber(params.speed, WEBTHREADS_DEFAULTS.speed)),
    WEBTHREADS_DEFAULTS.speed
  );

  const speed = mapSharedSpeed(rawSpeed, WEBTHREADS_DEFAULTS.speed, WEBTHREADS_RANGES.speed.max);
  const from = parseColor(props.from, WEBTHREADS_DEFAULTS.from);
  const to = parseColor(props.to, WEBTHREADS_DEFAULTS.to);

  return {
    speed,
    threadCount: Math.round(clamp(
      getNumber(getNumber(params.threadCount, WEBTHREADS_DEFAULTS.parameters.threadCount), WEBTHREADS_DEFAULTS.parameters.threadCount),
      WEBTHREADS_RANGES.threadCount.min,
      WEBTHREADS_RANGES.threadCount.max
    )),
    frequency: clamp(
      getNumber(getNumber(params.frequency, WEBTHREADS_DEFAULTS.parameters.frequency), WEBTHREADS_DEFAULTS.parameters.frequency),
      WEBTHREADS_RANGES.frequency.min,
      WEBTHREADS_RANGES.frequency.max
    ),
    spread: clamp(
      getNumber(getNumber(params.spread, WEBTHREADS_DEFAULTS.parameters.spread), WEBTHREADS_DEFAULTS.parameters.spread),
      WEBTHREADS_RANGES.spread.min,
      WEBTHREADS_RANGES.spread.max
    ),
    taper: clamp(
      getNumber(getNumber(params.taper, WEBTHREADS_DEFAULTS.parameters.taper), WEBTHREADS_DEFAULTS.parameters.taper),
      WEBTHREADS_RANGES.taper.min,
      WEBTHREADS_RANGES.taper.max
    ),
    position: clamp(
      getNumber(getNumber(params.position, WEBTHREADS_DEFAULTS.parameters.position), WEBTHREADS_DEFAULTS.parameters.position),
      WEBTHREADS_RANGES.position.min,
      WEBTHREADS_RANGES.position.max
    ),
    fanMode: parseFanMode(getString(params.fanMode) ?? WEBTHREADS_DEFAULTS.parameters.fanMode),
    glow: clamp(
      getNumber(getNumber(params.glow, WEBTHREADS_DEFAULTS.parameters.glow), WEBTHREADS_DEFAULTS.parameters.glow),
      WEBTHREADS_RANGES.glow.min,
      WEBTHREADS_RANGES.glow.max
    ),
    falloff: clamp(
      getNumber(getNumber(params.falloff, WEBTHREADS_DEFAULTS.parameters.falloff), WEBTHREADS_DEFAULTS.parameters.falloff),
      WEBTHREADS_RANGES.falloff.min,
      WEBTHREADS_RANGES.falloff.max
    ),
    thickness: clamp(
      getNumber(getNumber(params.thickness, WEBTHREADS_DEFAULTS.parameters.thickness), WEBTHREADS_DEFAULTS.parameters.thickness),
      WEBTHREADS_RANGES.thickness.min,
      WEBTHREADS_RANGES.thickness.max
    ),
    brightness: clamp(
      getNumber(getNumber(params.brightness, WEBTHREADS_DEFAULTS.parameters.brightness), WEBTHREADS_DEFAULTS.parameters.brightness),
      WEBTHREADS_RANGES.brightness.min,
      WEBTHREADS_RANGES.brightness.max
    ),
    opacity: clamp(
      getNumber(getNumber(params.opacity, WEBTHREADS_DEFAULTS.parameters.opacity), WEBTHREADS_DEFAULTS.parameters.opacity),
      WEBTHREADS_RANGES.opacity.min,
      WEBTHREADS_RANGES.opacity.max
    ),
    mirror: getBoolean(params.mirror, WEBTHREADS_DEFAULTS.parameters.mirror),
    shimmer: getBoolean(params.shimmer, WEBTHREADS_DEFAULTS.parameters.shimmer),
    grain: getBoolean(params.grain, WEBTHREADS_DEFAULTS.parameters.grain),
    grainIntensity: clamp(
      getNumber(getNumber(params.grainIntensity, WEBTHREADS_DEFAULTS.parameters.grainIntensity), WEBTHREADS_DEFAULTS.parameters.grainIntensity),
      WEBTHREADS_RANGES.grainIntensity.min,
      WEBTHREADS_RANGES.grainIntensity.max
    ),
    mouseInteraction: getBoolean(params.mouseInteraction, WEBTHREADS_DEFAULTS.mouseInteraction),
    mouseStrength: clamp(
      getNumber(
        getNumber(params.mouseStrength, WEBTHREADS_DEFAULTS.parameters.mouseStrength),
        WEBTHREADS_DEFAULTS.parameters.mouseStrength
      ),
      WEBTHREADS_RANGES.mouseStrength.min,
      WEBTHREADS_RANGES.mouseStrength.max
    ),
    colors: deriveColors(from, to)
  };
}

function fanModeToFloat(value: FanMode): number {
  if (value === "left") return 1;
  if (value === "right") return 2;
  return 0;
}

function compileShader(gl: WebGLContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader) ?? "Shader compile failed";
    gl.deleteShader(shader);
    throw new Error(reason);
  }
  return shader;
}

function createProgram(gl: WebGLContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error("Unable to create program");
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program) ?? "Program link failed";
    gl.deleteProgram(program);
    throw new Error(reason);
  }
  return program;
}

const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uThreadCount;
uniform float uFrequency;
uniform float uSpread;
uniform float uTaper;
uniform float uPosition;
uniform float uFanMode;
uniform float uGlow;
uniform float uFalloff;
uniform float uThickness;
uniform float uBrightness;
uniform float uOpacity;
uniform float uMirror;
uniform float uShimmer;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uEnableMouse;
uniform float uMouseActive;

#define TAU 6.28318530718
#define MAX_THREADS 10

float glow(float x, float str, float dist) {
  return dist / pow(max(x, 1e-4), str);
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float n = max(uThreadCount, 1.0);

  float pinchX = uFanMode < 0.5 ? 0.5 : (uFanMode < 1.5 ? 0.0 : 1.0);
  if (uEnableMouse > 0.5) {
    pinchX = mix(pinchX, uMouse.x, clamp(uMouseStrength, 0.0, 1.0) * uMouseActive);
  }

  float spreadDx = uSpread * abs(uv.x - pinchX);
  float baseT = iTime * uSpeed;
  float tauOverN = TAU / n;
  float mirror = uMirror > 0.5 ? sign(pinchX - uv.x) : 1.0;
  bool doShimmer = uShimmer > 0.5;
  float shimmerT = iTime * 1.7;
  float invThickness = 1.0 / max(uThickness, 0.01);
  float xFreq = uv.x * uFrequency;
  float yOff = uv.y - uPosition;
  float ciScale = n > 1.0 ? 1.0 / (n - 1.0) : 0.0;

  vec3 col = vec3(0.0);
  float gsum = 0.0;

  for (int idx = 0; idx < MAX_THREADS; idx++) {
    float i = float(idx);
    if (i >= n) break;

    float amplitude = spreadDx * (1.0 + i * uTaper);
    float shimmer = doShimmer ? sin(shimmerT + i * 1.3) * 0.35 : 0.0;
    float phase = (baseT + i * tauOverN) * mirror + shimmer;

    float sdf = abs(yOff + sin(xFreq + phase) * amplitude) * invThickness;

    float g = glow(sdf, uFalloff, uGlow);
    float ci = i * ciScale;
    vec3 threadCol = mix(uColor1, uColor2, ci);

    col += g * threadCol;
    gsum += g;
  }

  float coreAmt = smoothstep(0.5, 2.2, gsum);
  col = mix(col, uColor3 * gsum, coreAmt * 0.5);

  float bright = uBrightness;
  if (uEnableMouse > 0.5) {
    vec2 md = uv - uMouse;
    float d2 = dot(md, md);
    bright += clamp(uMouseStrength, 0.0, 1.0) * uMouseActive * exp(-d2 * 6.0) * 0.6;
  }
  col *= bright;

  float alpha = clamp(gsum, 0.0, 1.0) * uOpacity;
  vec3 outRgb = col * alpha;

  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    outRgb = clamp(outRgb + gv, 0.0, 1.0);
    alpha = clamp(alpha + gv, 0.0, 1.0);
  }

  gl_FragColor = vec4(outRgb, alpha);
}
`;

export function WebThreads({
  from,
  to,
  speed,
  parameters
}: WebThreadsProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformRef = useRef<Uniforms | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const settingsRef = useRef<WebThreadsSettings | null>(null);
  const animationRef = useRef<number>(0);
  const startRef = useRef(0);
  const targetMouse = useRef([0.5, 0.5]);
  const currentMouse = useRef([0.5, 0.5]);
  const targetActive = useRef(0);
  const active = useRef(0);

  const updateUniforms = (settings: WebThreadsSettings, gl: WebGLContext, uniforms: Uniforms): void => {
    gl.uniform1f(uniforms.uSpeed, settings.speed);
    gl.uniform1f(uniforms.uThreadCount, settings.threadCount);
    gl.uniform1f(uniforms.uFrequency, settings.frequency);
    gl.uniform1f(uniforms.uSpread, settings.spread);
    gl.uniform1f(uniforms.uTaper, settings.taper);
    gl.uniform1f(uniforms.uPosition, settings.position);
    gl.uniform1f(uniforms.uFanMode, fanModeToFloat(settings.fanMode));
    gl.uniform1f(uniforms.uGlow, settings.glow);
    gl.uniform1f(uniforms.uFalloff, settings.falloff);
    gl.uniform1f(uniforms.uThickness, settings.thickness);
    gl.uniform1f(uniforms.uBrightness, settings.brightness);
    gl.uniform1f(uniforms.uOpacity, settings.opacity);
    gl.uniform1f(uniforms.uMirror, settings.mirror ? 1.0 : 0.0);
    gl.uniform1f(uniforms.uShimmer, settings.shimmer ? 1.0 : 0.0);
    gl.uniform1f(uniforms.uGrain, settings.grain ? 1.0 : 0.0);
    gl.uniform1f(uniforms.uGrainIntensity, settings.grainIntensity);
    gl.uniform1f(uniforms.uMouseStrength, settings.mouseStrength);
    gl.uniform1f(uniforms.uEnableMouse, settings.mouseInteraction ? 1.0 : 0.0);
    gl.uniform3f(uniforms.uColor1, settings.colors.color1[0], settings.colors.color1[1], settings.colors.color1[2]);
    gl.uniform3f(uniforms.uColor2, settings.colors.color2[0], settings.colors.color2[1], settings.colors.color2[2]);
    gl.uniform3f(uniforms.uColor3, settings.colors.color3[0], settings.colors.color3[1], settings.colors.color3[2]);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const settings = resolveSettings({ from, to, speed, parameters });
    settingsRef.current = settings;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true
    }) as WebGLContext | null;
    if (!gl) return;

    glRef.current = gl;

    let disposed = false;
    let program: WebGLProgram | null = null;

    try {
      program = createProgram(gl);
      programRef.current = program;
      const vertices = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1
      ]);
      const buffer = gl.createBuffer();
      if (!buffer) {
        throw new Error("Unable to create WebGL buffer");
      }
      bufferRef.current = buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const position = gl.getAttribLocation(program, "position");
      if (position < 0) {
        throw new Error("WebThreads shader attributes missing");
      }
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const uniforms: Uniforms = {
        iResolution: gl.getUniformLocation(program, "iResolution"),
        iTime: gl.getUniformLocation(program, "iTime"),
        uSpeed: gl.getUniformLocation(program, "uSpeed"),
        uThreadCount: gl.getUniformLocation(program, "uThreadCount"),
        uFrequency: gl.getUniformLocation(program, "uFrequency"),
        uSpread: gl.getUniformLocation(program, "uSpread"),
        uTaper: gl.getUniformLocation(program, "uTaper"),
        uPosition: gl.getUniformLocation(program, "uPosition"),
        uFanMode: gl.getUniformLocation(program, "uFanMode"),
        uGlow: gl.getUniformLocation(program, "uGlow"),
        uFalloff: gl.getUniformLocation(program, "uFalloff"),
        uThickness: gl.getUniformLocation(program, "uThickness"),
        uBrightness: gl.getUniformLocation(program, "uBrightness"),
        uOpacity: gl.getUniformLocation(program, "uOpacity"),
        uMirror: gl.getUniformLocation(program, "uMirror"),
        uShimmer: gl.getUniformLocation(program, "uShimmer"),
        uGrain: gl.getUniformLocation(program, "uGrain"),
        uGrainIntensity: gl.getUniformLocation(program, "uGrainIntensity"),
        uColor1: gl.getUniformLocation(program, "uColor1"),
        uColor2: gl.getUniformLocation(program, "uColor2"),
        uColor3: gl.getUniformLocation(program, "uColor3"),
        uMouse: gl.getUniformLocation(program, "uMouse"),
        uMouseStrength: gl.getUniformLocation(program, "uMouseStrength"),
        uEnableMouse: gl.getUniformLocation(program, "uEnableMouse"),
        uMouseActive: gl.getUniformLocation(program, "uMouseActive")
      };
      uniformRef.current = uniforms;

      gl.useProgram(program);
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        if (uniforms.iResolution) {
          gl.uniform2f(uniforms.iResolution, width, height);
        }
      };
      const ro = new ResizeObserver(() => {
        resize();
      });
      ro.observe(canvas);
      resize();

      const onPointerMove = (event: PointerEvent) => {
        if (!settingsRef.current?.mouseInteraction) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        targetMouse.current[0] = (event.clientX - rect.left) / rect.width;
        targetMouse.current[1] = 1 - (event.clientY - rect.top) / rect.height;
        targetActive.current = 1;
      };
      const onMouseEnter = () => {
        targetActive.current = 1;
      };
      const onMouseLeave = () => {
        targetActive.current = 0;
      };

      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("mouseenter", onMouseEnter);
      canvas.addEventListener("mouseleave", onMouseLeave);

      updateUniforms(settings, gl, uniforms);

      const draw = (time: number) => {
        if (disposed) return;
        animationRef.current = requestAnimationFrame(draw);

        const currentSettings = settingsRef.current;
        if (!currentSettings) return;

        if (!startRef.current) startRef.current = time;
        if (uniforms.iTime) {
          gl.uniform1f(uniforms.iTime, (time - startRef.current) * 0.001);
        }

        currentMouse.current[0] += 0.05 * (targetMouse.current[0] - currentMouse.current[0]);
        currentMouse.current[1] += 0.05 * (targetMouse.current[1] - currentMouse.current[1]);

        active.current += 0.05 * (targetActive.current - active.current);

        if (uniforms.uMouse) {
          gl.uniform2f(uniforms.uMouse, currentMouse.current[0], currentMouse.current[1]);
        }
        if (uniforms.uMouseActive) gl.uniform1f(uniforms.uMouseActive, active.current);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };

      animationRef.current = requestAnimationFrame(draw);

      return () => {
        disposed = true;
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = 0;
        }
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("mouseenter", onMouseEnter);
        canvas.removeEventListener("mouseleave", onMouseLeave);
        ro.disconnect();
        if (buffer) {
          gl.deleteBuffer(buffer);
          bufferRef.current = null;
        }
        if (program) {
          gl.deleteProgram(program);
          programRef.current = null;
        }
        glRef.current = null;
      };
    } catch (error) {
      console.error("Failed to initialize WebThreads", error);
      if (program) {
        gl.deleteProgram(program);
        programRef.current = null;
      }
      glRef.current = null;
      return;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const settings = resolveSettings({ from, to, speed, parameters });
    settingsRef.current = settings;

    if (!canvas || !glRef.current || !programRef.current || !uniformRef.current) return;

    if (canvas.style) {
      canvas.style.pointerEvents = settings.mouseInteraction ? "auto" : "none";
    }

    const gl = glRef.current;
    const uniforms = uniformRef.current;
    updateUniforms(settings, gl, uniforms);
  }, [from, to, speed, parameters]);

  return <canvas className="dynamic-background" ref={canvasRef} />;
}

export default WebThreads;
