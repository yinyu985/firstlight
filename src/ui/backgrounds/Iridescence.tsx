import { type ReactElement, useEffect, useRef } from "react";
import { boundedCanvasSize } from "./canvasSizing";
import { bindWindowPointer } from "./pointerTracking";

type DynamicEffectParameterValue = string | number | boolean;
type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;
type Color = [number, number, number];

type IridescenceProps = {
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DynamicEffectParameters;
  color3?: string;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  className?: string;
};

interface IridescenceSettings {
  color: Color;
  speed: number;
  amplitude: number;
  brightness: number;
  contrast: number;
  lighting: number;
  mouseInteraction: boolean;
  mouseStrength: number;
}

export const IRIDESCENCE_DEFAULTS = {
  from: [1, 1, 1],
  to: [1, 1, 1],
  speed: 1,
  amplitude: 0.1,
  brightness: 1,
  contrast: 1,
  lighting: 0,
  mouseInteraction: true,
  mouseStrength: 1
} as const;

export const IRIDESCENCE_RANGES = {
  speed: { min: 0.05, max: 6, step: 0.01 },
  amplitude: { min: 0.02, max: 1.2, step: 0.01 },
  brightness: { min: 0, max: 2, step: 0.01 },
  contrast: { min: 0, max: 3, step: 0.01 },
  lighting: { min: 0, max: 1, step: 0.01 },
  mouseStrength: { min: 0, max: 3, step: 0.05 }
} as const;

const VERTEX_SHADER = `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uSpeed;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform float uBrightness;
uniform float uContrast;
uniform float uLighting;

varying vec2 vUv;

void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv.xy * 2.0 - 1.0) * uResolution.xy / mr;

  vec2 mousePoint = (uMouse * 2.0 - 1.0) * uResolution.xy / mr;
  vec2 mouseDelta = uv - mousePoint;
  float mouseDistance = length(mouseDelta);
  float mouseInfluence = exp(-dot(mouseDelta, mouseDelta) * 3.5) * uMouseStrength * uMouseActive;
  vec2 tangent = normalize(vec2(-mouseDelta.y, mouseDelta.x) + vec2(0.0001));
  float localWave = 0.55 + 0.45 * sin(mouseDistance * 13.0 - uTime * uSpeed);
  uv += tangent * localWave * mouseInfluence * uAmplitude * 0.16;

  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
  col = (col - 0.5) * uContrast + 0.5;
  col = col * uBrightness + vec3(uLighting * (0.08 + mouseInfluence * 0.12));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexToColor(value: string | undefined, fallback: string): Color {
  const source = (value ?? fallback).trim();
  const raw = source[0] === "#" ? source.slice(1) : source;
  const hex = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  if (hex.length !== 6) {
    const fallbackBody = fallback[0] === "#" ? fallback.slice(1) : fallback;
    const normalized = fallbackBody.length === 3
      ? fallbackBody.split("").map((char) => `${char}${char}`).join("")
      : fallbackBody;
    const parsed = Number.parseInt(normalized, 16);
    return [
      ((parsed >> 16) & 255) / 255,
      ((parsed >> 8) & 255) / 255,
      (parsed & 255) / 255
    ];
  }
  const parsed = Number.parseInt(hex, 16);
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255
  ];
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mix(a: Color, b: Color, t: number): Color {
  return [
    clamp(a[0] + (b[0] - a[0]) * t, 0, 1),
    clamp(a[1] + (b[1] - a[1]) * t, 0, 1),
    clamp(a[2] + (b[2] - a[2]) * t, 0, 1)
  ];
}

function blendWithColor3(from: Color, to: Color, color3: Color, amount: number): Color {
  const base = mix(from, to, 0.5);
  const t = clamp(amount, 0, 1);
  return [
    clamp(base[0] * (1 - t) + color3[0] * t, 0, 1),
    clamp(base[1] * (1 - t) + color3[1] * t, 0, 1),
    clamp(base[2] * (1 - t) + color3[2] * t, 0, 1)
  ];
}

function deriveColor3(from: Color, to: Color, params: DynamicEffectParameters): Color {
  const contrast = getNumber(params.contrast, 1);
  const lighting = getNumber(params.lighting, 0);
  const brightness = getNumber(params.brightness, 1);
  const base = mix(from, to, 0.5);
  const t = clamp((contrast - 1) * 0.12 + lighting * 0.3 + brightness * 0.1, 0, 0.5);
  return [
    clamp(base[0] * (1 + t), 0, 1),
    clamp(base[1] * (1 + t), 0, 1),
    clamp(base[2] * (1 + t), 0, 1)
  ];
}

function resolveSharedSpeed(value: number, fallback: number): number {
  if (value >= 10 && value <= 20) {
    const normalized = clamp((value - 10) / 10, 0, 1);
    return fallback * (0.54 + 1.67 * normalized ** 1.6);
  }
  return clamp(value, IRIDESCENCE_RANGES.speed.min, IRIDESCENCE_RANGES.speed.max);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) ?? "Shader compile failed";
    gl.deleteShader(shader);
    throw new Error(error);
  }
  return shader;
}

function resolveSettings(props: IridescenceProps): IridescenceSettings {
  const params = props.parameters ?? {};
  const from = parseHexToColor(props.from, "#ffffff");
  const to = parseHexToColor(props.to, "#ffffff");
  const color3Param = getString(props.color3) ?? getString(params.color3);
  const color3 = color3Param
    ? parseHexToColor(color3Param, "#ffffff")
    : deriveColor3(from, to, params);

  const rawSpeed = getNumber(
    getNumber(props.speed, getNumber(params.speed, IRIDESCENCE_DEFAULTS.speed)),
    IRIDESCENCE_DEFAULTS.speed
  );
  const speed = resolveSharedSpeed(rawSpeed, IRIDESCENCE_DEFAULTS.speed);
  const amplitudeSource = getNumber(
    getNumber(params.amplitude, getNumber((params as Record<string, number>).scale, IRIDESCENCE_DEFAULTS.amplitude)),
    IRIDESCENCE_DEFAULTS.amplitude
  );

  return {
    color: blendWithColor3(from, to, color3, clamp((0.2 + (getNumber(params.contrast, 1) - 1) * 0.1 + getNumber(params.lighting, 0) * 0.2), 0, 0.55)),
    speed: clamp(speed, IRIDESCENCE_RANGES.speed.min, IRIDESCENCE_RANGES.speed.max),
    amplitude: clamp(amplitudeSource, IRIDESCENCE_RANGES.amplitude.min, IRIDESCENCE_RANGES.amplitude.max),
    brightness: clamp(getNumber(params.brightness, IRIDESCENCE_DEFAULTS.brightness), IRIDESCENCE_RANGES.brightness.min, IRIDESCENCE_RANGES.brightness.max),
    contrast: clamp(getNumber(params.contrast, IRIDESCENCE_DEFAULTS.contrast), IRIDESCENCE_RANGES.contrast.min, IRIDESCENCE_RANGES.contrast.max),
    lighting: clamp(getNumber(params.lighting, IRIDESCENCE_DEFAULTS.lighting), IRIDESCENCE_RANGES.lighting.min, IRIDESCENCE_RANGES.lighting.max),
    mouseInteraction: getBoolean(props.mouseInteraction, getBoolean(params.mouseInteraction, IRIDESCENCE_DEFAULTS.mouseInteraction)),
    mouseStrength: clamp(getNumber(props.mouseStrength, getNumber((params as Record<string, number>).mouseStrength, IRIDESCENCE_DEFAULTS.mouseStrength)), IRIDESCENCE_RANGES.mouseStrength.min, IRIDESCENCE_RANGES.mouseStrength.max)
  };
}

export function Iridescence({
  className = "dynamic-background",
  ...rest
}: IridescenceProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = resolveSettings(rest);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { alpha: true, antialias: true });
    if (!gl) return;

    let disposed = false;
    let frameId = 0;
    const program = (() => {
      try {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        const p = gl.createProgram();
        if (!p) {
          gl.deleteShader(vs);
          gl.deleteShader(fs);
          return null;
        }
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          gl.deleteProgram(p);
          return null;
        }
        return p;
      } catch {
        return null;
      }
    })();
    if (!program) return;

    const geometry = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1
    ]);

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, "position");
    const uv = gl.getAttribLocation(program, "uv");
    if (position === -1 || uv === -1) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }

    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(uv);

    gl.useProgram(program);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);

    const uTime = gl.getUniformLocation(program, "uTime");
    const uColor = gl.getUniformLocation(program, "uColor");
    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uAmplitude = gl.getUniformLocation(program, "uAmplitude");
    const uSpeed = gl.getUniformLocation(program, "uSpeed");
    const uMouseStrength = gl.getUniformLocation(program, "uMouseStrength");
    const uMouseActive = gl.getUniformLocation(program, "uMouseActive");
    const uBrightness = gl.getUniformLocation(program, "uBrightness");
    const uContrast = gl.getUniformLocation(program, "uContrast");
    const uLighting = gl.getUniformLocation(program, "uLighting");
    if (!uTime || !uColor || !uResolution || !uMouse || !uAmplitude || !uSpeed || !uMouseStrength || !uMouseActive || !uBrightness || !uContrast || !uLighting) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }

    const cursor = { x: 0.5, y: 0.5 };
    const targetCursor = { x: 0.5, y: 0.5 };
    let mouseActive = 0;
    let targetMouseActive = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const { width, height } = boundedCanvasSize(rect.width, rect.height);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform3f(uResolution, width, height, width / Math.max(1, height));
    };

    const unbindPointer = bindWindowPointer(canvas, (pointer) => {
      if (!settings.mouseInteraction) return;
      targetCursor.x = pointer.x;
      targetCursor.y = pointer.y;
    }, (isActive) => {
      targetMouseActive = settings.mouseInteraction && isActive ? 1 : 0;
    });
    canvas.style.pointerEvents = "none";

    const render = (time: number) => {
      if (disposed) return;
      cursor.x += (targetCursor.x - cursor.x) * 0.1;
      cursor.y += (targetCursor.y - cursor.y) * 0.1;
      mouseActive += (targetMouseActive - mouseActive) * 0.08;
      gl.uniform3f(uColor, settings.color[0], settings.color[1], settings.color[2]);
      gl.uniform2f(uMouse, cursor.x, cursor.y);
      gl.uniform1f(uAmplitude, settings.amplitude);
      gl.uniform1f(uSpeed, settings.speed);
      gl.uniform1f(uMouseStrength, settings.mouseInteraction ? settings.mouseStrength : 0);
      gl.uniform1f(uMouseActive, mouseActive);
      gl.uniform1f(uBrightness, settings.brightness);
      gl.uniform1f(uContrast, settings.contrast);
      gl.uniform1f(uLighting, settings.lighting);
      gl.uniform1f(uTime, time * 0.001);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frameId = requestAnimationFrame(render);
    };

    resize();
    const startLoop = () => {
      if (!disposed && frameId === 0) {
        frameId = requestAnimationFrame(render);
      }
    };
    const stopLoop = () => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };

    window.addEventListener("resize", resize);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopLoop();
      } else {
        startLoop();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    startLoop();

    return () => {
      disposed = true;
      stopLoop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      unbindPointer();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [
    settings.color[0],
    settings.color[1],
    settings.color[2],
    settings.speed,
    settings.amplitude,
    settings.brightness,
    settings.contrast,
    settings.lighting,
    settings.mouseInteraction,
    settings.mouseStrength,
    className
  ]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default Iridescence;
