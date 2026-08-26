import { type ReactElement, useEffect, useRef } from "react";
import { boundedCanvasSize } from "./canvasSizing";
import { bindWindowPointer } from "./pointerTracking";

type DynamicEffectParameterValue = string | number | boolean;
type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;
type Color = [number, number, number];

type LiquidChromeProps = {
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DynamicEffectParameters;
  color3?: string;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  className?: string;
};

interface LiquidChromeSettings {
  accentColor: Color;
  baseColor: Color;
  colorFrom: Color;
  colorTo: Color;
  speed: number;
  amplitude: number;
  frequencyX: number;
  frequencyY: number;
  brightness: number;
  contrast: number;
  lighting: number;
  mouseInteraction: boolean;
  mouseStrength: number;
}

export const LIQUID_CHROME_DEFAULTS = {
  accentColor: [0.84, 0.87, 0.89] as Color,
  baseColor: [0.1, 0.1, 0.1] as Color,
  colorFrom: [0.04, 0.08, 0.12] as Color,
  colorTo: [0.22, 0.58, 0.64] as Color,
  speed: 0.2,
  amplitude: 0.2,
  frequencyX: 3,
  frequencyY: 2,
  brightness: 1,
  contrast: 1.05,
  lighting: 0.55,
  mouseInteraction: true,
  mouseStrength: 1
} as const;

export const LIQUID_CHROME_RANGES = {
  speed: { min: 0.02, max: 2.0, step: 0.01 },
  amplitude: { min: 0.02, max: 0.3, step: 0.01 },
  frequencyX: { min: 0.5, max: 12, step: 0.1 },
  frequencyY: { min: 0.5, max: 12, step: 0.1 },
  brightness: { min: 0, max: 2, step: 0.01 },
  contrast: { min: 0, max: 3, step: 0.01 },
  lighting: { min: 0, max: 1, step: 0.01 },
  mouseStrength: { min: 0, max: 3, step: 0.05 }
} as const;

const VERTEX_SHADER = `
attribute vec2 position;
attribute vec2 uv;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform vec3 uBaseColor;
uniform vec3 uColorFrom;
uniform vec3 uColorTo;
uniform vec3 uAccentColor;
uniform float uAmplitude;
uniform float uFrequencyX;
uniform float uFrequencyY;
uniform vec2 uMouse;
uniform vec2 uMouseDirection;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform float uBrightness;
uniform float uContrast;
uniform float uLighting;

varying vec2 vUv;

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
    float weight = 0.52;
    mat2 turn = mat2(0.80, 0.60, -0.60, 0.80);
    for (int octave = 0; octave < 4; octave++) {
        value += noise(point) * weight;
        point = turn * point * 2.03 + vec2(13.7, 7.9);
        weight *= 0.5;
    }
    return value / 0.975;
}

float liquidSurface(vec2 point) {
    vec2 frequency = vec2(uFrequencyX * 0.31, uFrequencyY * 0.43);
    vec2 q = point * frequency;
    float slowWarp = fbm(q * 0.54 + vec2(uTime * 0.055, -uTime * 0.042));
    float crossWarp = fbm(q * 0.73 + vec2(-uTime * 0.047, uTime * 0.061) + slowWarp * 1.7);
    float warpStrength = 0.38 + uAmplitude * 5.4;
    vec2 warped = q + vec2(slowWarp - 0.5, crossWarp - 0.5) * warpStrength;
    float body = fbm(warped + vec2(-uTime * 0.075, uTime * 0.052));
    float ribbon = sin(warped.x * 1.28 - warped.y * 1.06 + (slowWarp - crossWarp) * 4.8 + uTime * 0.18);
    return body * 0.78 + ribbon * 0.11 + crossWarp * 0.11;
}

vec4 renderImage(vec2 uvCoord) {
    vec2 fragCoord = uvCoord * uResolution.xy;
    vec2 uv = (2.0 * fragCoord - uResolution.xy) / max(1.0, min(uResolution.x, uResolution.y));
    vec2 mousePoint = (2.0 * uMouse * uResolution.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
    vec2 mouseDelta = uv - mousePoint;
    float influence = exp(-dot(mouseDelta, mouseDelta) * 4.2) * uMouseStrength * uMouseActive;
    vec2 flowDirection = normalize(uMouseDirection + vec2(0.0001));
    vec2 flowNormal = vec2(-flowDirection.y, flowDirection.x);
    float crossFlow = dot(mouseDelta, flowNormal);
    uv += flowDirection * influence * uAmplitude * 0.62;
    uv += flowNormal * sin(crossFlow * 9.0 - uTime * 0.9) * influence * uAmplitude * 0.82;

    float epsilon = 2.2 / max(600.0, min(uResolution.x, uResolution.y));
    float height = liquidSurface(uv);
    float heightX = liquidSurface(uv + vec2(epsilon, 0.0));
    float heightY = liquidSurface(uv + vec2(0.0, epsilon));
    vec2 slope = vec2(heightX - height, heightY - height) / epsilon;
    vec3 normal = normalize(vec3(-slope * (0.17 + uAmplitude * 1.75), 1.0));
    vec3 reflected = reflect(vec3(0.0, 0.0, -1.0), normal);

    float environment = clamp(0.5 + reflected.y * 0.46 + reflected.x * 0.10, 0.0, 1.0);
    float broadLight = smoothstep(0.18, 0.82, environment);
    float brightRibbon = exp(-pow((environment - 0.78) * 12.0, 2.0));
    float sharpGlint = exp(-pow((environment - 0.91) * 30.0, 2.0));
    float darkRibbon = exp(-pow((environment - 0.34) * 9.0, 2.0));
    float fresnel = pow(1.0 - max(normal.z, 0.0), 2.4);

    float palettePosition = clamp(0.5 + height * 0.36 + normal.x * 0.18, 0.0, 1.0);
    vec3 metal = mix(uColorFrom, uColorTo, palettePosition);
    metal = mix(metal, uBaseColor, 0.24);
    vec3 color = metal * (0.16 + broadLight * 0.86);
    color = mix(color, uAccentColor * (0.72 + uLighting * 0.45), brightRibbon * 0.62);
    color += vec3(0.88, 0.94, 1.0) * sharpGlint * (0.42 + uLighting * 0.74);
    color += mix(uColorTo, uAccentColor, 0.55) * fresnel * (0.18 + uLighting * 0.30);
    color *= 1.0 - darkRibbon * 0.56;
    color += vec3(influence * 0.035);
    color = (color - 0.5) * uContrast + 0.5;
    color *= uBrightness;
    return vec4(clamp(color, 0.0, 1.0), 1.0);
}

void main() {
    gl_FragColor = renderImage(vUv);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexToColor(value: string | undefined, fallback: Color): Color {
  const source = (value ?? `${toHex(fallback)}`).trim();
  const raw = source[0] === "#" ? source.slice(1) : source;
  const hex = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  if (hex.length !== 6) {
    return fallback;
  }
  const parsed = Number.parseInt(hex, 16);
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255
  ];
}

function toHex(color: Color): string {
  return [
    Math.round(clamp(color[0], 0, 1) * 255).toString(16).padStart(2, "0"),
    Math.round(clamp(color[1], 0, 1) * 255).toString(16).padStart(2, "0"),
    Math.round(clamp(color[2], 0, 1) * 255).toString(16).padStart(2, "0")
  ].join("");
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

function deriveColor3(from: Color, to: Color, params: DynamicEffectParameters): Color {
  const contrast = getNumber(params.contrast, 1);
  const brightness = getNumber(params.brightness, 1);
  const lighting = getNumber(params.lighting, 0);
  const base = mix(from, to, 0.5);
  const tone = clamp((contrast - 1) * 0.08 + lighting * 0.25 + (brightness - 1) * 0.2, 0, 0.5);
  return [
    clamp(base[0] + tone, 0, 1),
    clamp(base[1] + tone, 0, 1),
    clamp(base[2] + tone, 0, 1)
  ];
}

function clamp01Color(value: Color): Color {
  return [
    clamp(value[0], 0, 1),
    clamp(value[1], 0, 1),
    clamp(value[2], 0, 1)
  ];
}

function blendWithColor3(from: Color, to: Color, third: Color): Color {
  const mid = mix(from, to, 0.5);
  return [
    clamp(mid[0] * 0.85 + third[0] * 0.15, 0, 1),
    clamp(mid[1] * 0.85 + third[1] * 0.15, 0, 1),
    clamp(mid[2] * 0.85 + third[2] * 0.15, 0, 1)
  ];
}

function resolveSharedSpeed(value: number, fallback: number): number {
  if (value >= 10 && value <= 20) {
    const normalized = clamp((value - 10) / 10, 0, 1);
    return fallback * (0.54 + 1.67 * normalized ** 1.6);
  }
  return clamp(value, LIQUID_CHROME_RANGES.speed.min, LIQUID_CHROME_RANGES.speed.max);
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

export function resolveLiquidChromeSettings(props: LiquidChromeProps): LiquidChromeSettings {
  const params = props.parameters ?? {};
  const from = parseHexToColor(props.from, LIQUID_CHROME_DEFAULTS.baseColor);
  const to = parseHexToColor(props.to, LIQUID_CHROME_DEFAULTS.baseColor);
  const c3Input = getString(props.color3) ?? getString(params.color3);
  const color3 = c3Input
    ? parseHexToColor(c3Input, LIQUID_CHROME_DEFAULTS.baseColor)
    : deriveColor3(from, to, params);
  const base = blendWithColor3(from, to, color3);

  const rawSpeed = getNumber(
    getNumber(props.speed, getNumber(params.speed, LIQUID_CHROME_DEFAULTS.speed)),
    LIQUID_CHROME_DEFAULTS.speed
  );
  const resolvedSpeed = resolveSharedSpeed(rawSpeed, LIQUID_CHROME_DEFAULTS.speed);

  return {
    accentColor: clamp01Color(color3),
    baseColor: clamp01Color(base),
    colorFrom: clamp01Color(from),
    colorTo: clamp01Color(to),
    speed: clamp(resolvedSpeed, LIQUID_CHROME_RANGES.speed.min, LIQUID_CHROME_RANGES.speed.max),
    amplitude: clamp(
      getNumber(params.amplitude, getNumber((params as Record<string, number>).scale, LIQUID_CHROME_DEFAULTS.amplitude)),
      LIQUID_CHROME_RANGES.amplitude.min,
      LIQUID_CHROME_RANGES.amplitude.max
    ),
    frequencyX: clamp(getNumber(params.frequencyX, LIQUID_CHROME_DEFAULTS.frequencyX), LIQUID_CHROME_RANGES.frequencyX.min, LIQUID_CHROME_RANGES.frequencyX.max),
    frequencyY: clamp(getNumber(params.frequencyY, LIQUID_CHROME_DEFAULTS.frequencyY), LIQUID_CHROME_RANGES.frequencyY.min, LIQUID_CHROME_RANGES.frequencyY.max),
    brightness: clamp(getNumber(params.brightness, LIQUID_CHROME_DEFAULTS.brightness), LIQUID_CHROME_RANGES.brightness.min, LIQUID_CHROME_RANGES.brightness.max),
    contrast: clamp(getNumber(params.contrast, LIQUID_CHROME_DEFAULTS.contrast), LIQUID_CHROME_RANGES.contrast.min, LIQUID_CHROME_RANGES.contrast.max),
    lighting: clamp(getNumber(params.lighting, LIQUID_CHROME_DEFAULTS.lighting), LIQUID_CHROME_RANGES.lighting.min, LIQUID_CHROME_RANGES.lighting.max),
    mouseInteraction: getBoolean(
      props.mouseInteraction,
      getBoolean(params.mouseInteraction, getBoolean(params.interactive, LIQUID_CHROME_DEFAULTS.mouseInteraction))
    ),
    mouseStrength: clamp(getNumber(props.mouseStrength, getNumber((params as Record<string, number>).mouseStrength, LIQUID_CHROME_DEFAULTS.mouseStrength)), LIQUID_CHROME_RANGES.mouseStrength.min, LIQUID_CHROME_RANGES.mouseStrength.max)
  };
}

function createBuffer(gl: WebGLRenderingContext): WebGLBuffer | null {
  const geometry = new Float32Array([
    -1, -1, 0, 0,
    1, -1, 1, 0,
    -1, 1, 0, 1,
    1, 1, 1, 1
  ]);
  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
  return buffer;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error("WebGL program allocation failed");
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program) ?? "WebGL link failed";
    gl.deleteProgram(program);
    throw new Error(reason);
  }
  return program;
}

export function LiquidChrome({
  className = "dynamic-background",
  ...rest
}: LiquidChromeProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = resolveLiquidChromeSettings(rest);
  const [accentRed, accentGreen, accentBlue] = settings.accentColor;
  const [baseRed, baseGreen, baseBlue] = settings.baseColor;
  const [fromRed, fromGreen, fromBlue] = settings.colorFrom;
  const [toRed, toGreen, toBlue] = settings.colorTo;
  const {
    amplitude,
    brightness,
    contrast,
    frequencyX,
    frequencyY,
    lighting,
    mouseInteraction,
    mouseStrength,
    speed
  } = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "low-power"
    });
    if (!gl) return;

    let disposed = false;
    let frameId = 0;
    let program: WebGLProgram;
    let buffer: WebGLBuffer | null;

    try {
      program = createProgram(gl);
      buffer = createBuffer(gl);
      if (!buffer) {
        gl.deleteProgram(program);
        return;
      }
    } catch {
      return;
    }

    const position = gl.getAttribLocation(program, "position");
    const uv = gl.getAttribLocation(program, "uv");
    if (position === -1 || uv === -1) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }

    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);

    const uTime = gl.getUniformLocation(program, "uTime");
    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uBaseColor = gl.getUniformLocation(program, "uBaseColor");
    const uColorFrom = gl.getUniformLocation(program, "uColorFrom");
    const uColorTo = gl.getUniformLocation(program, "uColorTo");
    const uAccentColor = gl.getUniformLocation(program, "uAccentColor");
    const uAmplitude = gl.getUniformLocation(program, "uAmplitude");
    const uFrequencyX = gl.getUniformLocation(program, "uFrequencyX");
    const uFrequencyY = gl.getUniformLocation(program, "uFrequencyY");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uMouseDirection = gl.getUniformLocation(program, "uMouseDirection");
    const uMouseStrength = gl.getUniformLocation(program, "uMouseStrength");
    const uMouseActive = gl.getUniformLocation(program, "uMouseActive");
    const uBrightness = gl.getUniformLocation(program, "uBrightness");
    const uContrast = gl.getUniformLocation(program, "uContrast");
    const uLighting = gl.getUniformLocation(program, "uLighting");
    if (!uTime || !uResolution || !uBaseColor || !uColorFrom || !uColorTo || !uAccentColor || !uAmplitude || !uFrequencyX || !uFrequencyY || !uMouse || !uMouseDirection || !uMouseStrength || !uMouseActive || !uBrightness || !uContrast || !uLighting) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }

    const cursor = { x: 0.5, y: 0.5 };
    const targetCursor = { x: 0.5, y: 0.5 };
    const direction = { x: 1, y: 0 };
    const targetDirection = { x: 1, y: 0 };
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
      if (!mouseInteraction) return;
      const dx = pointer.x - targetCursor.x;
      const dy = pointer.y - targetCursor.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.0001) {
        targetDirection.x = dx / distance;
        targetDirection.y = dy / distance;
      }
      targetCursor.x = pointer.x;
      targetCursor.y = pointer.y;
    }, (isActive) => {
      targetMouseActive = mouseInteraction && isActive ? 1 : 0;
    });
    canvas.style.pointerEvents = "none";

    const render = (time: number) => {
      if (disposed) return;
      cursor.x += (targetCursor.x - cursor.x) * 0.1;
      cursor.y += (targetCursor.y - cursor.y) * 0.1;
      direction.x += (targetDirection.x - direction.x) * 0.08;
      direction.y += (targetDirection.y - direction.y) * 0.08;
      mouseActive += (targetMouseActive - mouseActive) * 0.08;
      gl.uniform1f(uTime, time * 0.001 * speed);
      gl.uniform3f(uBaseColor, baseRed, baseGreen, baseBlue);
      gl.uniform3f(uColorFrom, fromRed, fromGreen, fromBlue);
      gl.uniform3f(uColorTo, toRed, toGreen, toBlue);
      gl.uniform3f(uAccentColor, accentRed, accentGreen, accentBlue);
      gl.uniform1f(uAmplitude, amplitude);
      gl.uniform1f(uFrequencyX, frequencyX);
      gl.uniform1f(uFrequencyY, frequencyY);
      gl.uniform2f(uMouse, cursor.x, cursor.y);
      gl.uniform2f(uMouseDirection, direction.x, direction.y);
      gl.uniform1f(uMouseStrength, mouseInteraction ? mouseStrength : 0);
      gl.uniform1f(uMouseActive, mouseActive);
      gl.uniform1f(uBrightness, brightness);
      gl.uniform1f(uContrast, contrast);
      gl.uniform1f(uLighting, lighting);
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
    accentBlue,
    accentGreen,
    accentRed,
    amplitude,
    baseBlue,
    baseGreen,
    baseRed,
    brightness,
    contrast,
    frequencyX,
    frequencyY,
    fromBlue,
    fromGreen,
    fromRed,
    lighting,
    mouseInteraction,
    mouseStrength,
    speed,
    toBlue,
    toGreen,
    toRed
  ]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default LiquidChrome;
