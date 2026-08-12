import { type ReactElement, useEffect, useRef } from "react";

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
  baseColor: Color;
  speed: number;
  amplitude: number;
  frequencyX: number;
  frequencyY: number;
  mouseInteraction: boolean;
  mouseStrength: number;
}

export const LIQUID_CHROME_DEFAULTS = {
  baseColor: [0.1, 0.1, 0.1] as Color,
  speed: 0.2,
  amplitude: 0.2,
  frequencyX: 3,
  frequencyY: 2,
  mouseInteraction: true,
  mouseStrength: 1
} as const;

export const LIQUID_CHROME_RANGES = {
  speed: { min: 0.02, max: 2.0, step: 0.01 },
  amplitude: { min: 0.02, max: 0.3, step: 0.01 },
  frequencyX: { min: 0.5, max: 12, step: 0.1 },
  frequencyY: { min: 0.5, max: 12, step: 0.1 },
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
uniform float uAmplitude;
uniform float uFrequencyX;
uniform float uFrequencyY;
uniform vec2 uMouse;
uniform float uMouseStrength;

varying vec2 vUv;

vec4 renderImage(vec2 uvCoord) {
    vec2 fragCoord = uvCoord * uResolution.xy;
    vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);

    for (float i = 1.0; i < 10.0; i++) {
        uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
        uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
    }

    vec2 diff = (uvCoord - uMouse);
    float dist = length(diff);
    float falloff = exp(-dist * 20.0);
    float ripple = sin(10.0 * dist - uTime * 2.0) * 0.03;
    uv += (dist > 0.0001 ? diff / dist : vec2(0.0)) * ripple * falloff * uMouseStrength;

    vec3 color = uBaseColor / abs(sin(uTime - uv.y - uv.x));
    return vec4(color, 1.0);
}

void main() {
    vec4 col = vec4(0.0);
    int samples = 0;
    for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
            vec2 offset = vec2(float(i), float(j)) * (1.0 / min(uResolution.x, uResolution.y));
            col += renderImage(vUv + offset);
            samples++;
        }
    }
    gl_FragColor = col / float(samples);
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
    baseColor: clamp01Color(base),
    speed: clamp(resolvedSpeed, LIQUID_CHROME_RANGES.speed.min, LIQUID_CHROME_RANGES.speed.max),
    amplitude: clamp(
      getNumber(params.amplitude, getNumber((params as Record<string, number>).scale, LIQUID_CHROME_DEFAULTS.amplitude)),
      LIQUID_CHROME_RANGES.amplitude.min,
      LIQUID_CHROME_RANGES.amplitude.max
    ),
    frequencyX: clamp(getNumber(params.frequencyX, LIQUID_CHROME_DEFAULTS.frequencyX), LIQUID_CHROME_RANGES.frequencyX.min, LIQUID_CHROME_RANGES.frequencyX.max),
    frequencyY: clamp(getNumber(params.frequencyY, LIQUID_CHROME_DEFAULTS.frequencyY), LIQUID_CHROME_RANGES.frequencyY.min, LIQUID_CHROME_RANGES.frequencyY.max),
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
    const uAmplitude = gl.getUniformLocation(program, "uAmplitude");
    const uFrequencyX = gl.getUniformLocation(program, "uFrequencyX");
    const uFrequencyY = gl.getUniformLocation(program, "uFrequencyY");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uMouseStrength = gl.getUniformLocation(program, "uMouseStrength");
    if (!uTime || !uResolution || !uBaseColor || !uAmplitude || !uFrequencyX || !uFrequencyY || !uMouse || !uMouseStrength) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }

    const cursor = { x: 0.5, y: 0.5 };

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
      gl.uniform3f(uResolution, width, height, width / Math.max(1, height));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!settings.mouseInteraction) return;
      const rect = canvas.getBoundingClientRect();
      cursor.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      cursor.y = 1 - (event.clientY - rect.top) / rect.height;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!settings.mouseInteraction || event.touches.length === 0) return;
      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      cursor.x = clamp((touch.clientX - rect.left) / rect.width, 0, 1);
      cursor.y = 1 - (touch.clientY - rect.top) / rect.height;
    };

    const render = (time: number) => {
      if (disposed) return;
      gl.uniform1f(uTime, time * 0.001 * settings.speed);
      gl.uniform3f(uBaseColor, settings.baseColor[0], settings.baseColor[1], settings.baseColor[2]);
      gl.uniform1f(uAmplitude, settings.amplitude);
      gl.uniform1f(uFrequencyX, settings.frequencyX);
      gl.uniform1f(uFrequencyY, settings.frequencyY);
      gl.uniform2f(uMouse, cursor.x, cursor.y);
      gl.uniform1f(uMouseStrength, settings.mouseInteraction ? settings.mouseStrength : 0);
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
    if (settings.mouseInteraction) {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("touchmove", onTouchMove, { passive: true });
      canvas.style.pointerEvents = "auto";
    } else {
      canvas.style.pointerEvents = "none";
    }

    startLoop();

    return () => {
      disposed = true;
      stopLoop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("touchmove", onTouchMove);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [
    settings.baseColor[0],
    settings.baseColor[1],
    settings.baseColor[2],
    settings.speed,
    settings.amplitude,
    settings.frequencyX,
    settings.frequencyY,
    settings.mouseInteraction,
    settings.mouseStrength,
    className
  ]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default LiquidChrome;
