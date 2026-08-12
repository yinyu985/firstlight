import { type ReactElement, useEffect, useRef } from "react";

type DynamicEffectParameterValue = string | number | boolean;
type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;
type HexColor = [number, number, number];

type MoltenMetalColorMode = "molten" | "ember" | "frost";

export interface MoltenMetalProps {
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DynamicEffectParameters;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  color3?: string;
  className?: string;
}

interface MoltenMetalSettings {
  color1: HexColor;
  color2: HexColor;
  color3: HexColor;
  speed: number;
  scale: number;
  detail: number;
  glow: number;
  coreSize: number;
  swirl: number;
  fold: number;
  blackPoint: number;
  brightness: number;
  colorMode: MoltenMetalColorMode;
  grain: boolean;
  grainIntensity: number;
  mouseInteraction: boolean;
  mouseStrength: number;
  opacity: number;
}

export const MOLTEN_METAL_DEFAULTS = {
  from: "#5227FF",
  to: "#FF9FFC",
  speed: 0.35,
  scale: 4,
  detail: 3,
  glow: 1.6,
  coreSize: 0.1,
  swirl: 1,
  fold: -0.2,
  blackPoint: 0.05,
  brightness: 1.3,
  colorMode: "molten" as const,
  grain: true,
  grainIntensity: 0.05,
  mouseInteraction: true,
  mouseStrength: 0.3,
  opacity: 1
} as const;

export const MOLTEN_METAL_RANGES = {
  speed: { min: 0.02, max: 2.5, step: 0.01 },
  scale: { min: 0.5, max: 12, step: 0.1 },
  detail: { min: 1, max: 8, step: 1 },
  glow: { min: 0.1, max: 6, step: 0.1 },
  coreSize: { min: 0.001, max: 1, step: 0.001 },
  swirl: { min: -3, max: 3, step: 0.05 },
  fold: { min: -3, max: 3, step: 0.01 },
  blackPoint: { min: 0, max: 1, step: 0.001 },
  brightness: { min: 0.2, max: 4, step: 0.01 },
  grainIntensity: { min: 0, max: 0.4, step: 0.001 },
  mouseStrength: { min: 0, max: 3, step: 0.05 },
  opacity: { min: 0, max: 1, step: 0.01 }
} as const;

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
uniform float uScale;
uniform float uDetail;
uniform float uGlow;
uniform float uCoreSize;
uniform float uSwirl;
uniform float uFold;
uniform float uBlackPoint;
uniform float uBrightness;
uniform float uColorMode;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uEnableMouse;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float time = iTime * uSpeed;
  vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;

  vec2 drift = vec2(0.0);
  if (uEnableMouse > 0.5) {
    drift = (uMouse - vec2(0.5)) * uMouseStrength * 2.0;
  }
  p += drift;

  vec2 i = p;
  float c = 0.0;
  float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
  float d = length(p);
  float rot = d + time + p.x * uSwirl;

  float cosRot = cos(rot);
  mat2 warp = mat2(
    cos(rot - sin(time / 5.0)),
    sin(rot),
    -sin(cosRot - time),
    cosRot
  ) * uFold;
  float glowCore = uGlow * uCoreSize;

  for (float n = 0.0; n < 8.0; n++) {
    if (n >= uDetail) break;
    p *= warp;
    float t = r - time / (n + 3.0);
    i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
    c += glowCore / length(vec2(sin(i.x + t), cos(i.y + t)));
  }

  c /= 6.0;
  float intensity = max(c - uBlackPoint, 0.0) * uBrightness;
  float g = clamp(intensity, 0.0, 1.0);

  float mid = 0.5;
  if (uColorMode > 1.5) {
    mid = 0.65;
  } else if (uColorMode > 0.5) {
    mid = 0.35;
  }

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, mid, g));
  col = mix(col, uColor3, smoothstep(mid, 1.0, g));

  float a = g;
  if (uGrain > 0.5) {
    float gr = hash(gl_FragCoord.xy + iTime);
    a += (gr - 0.5) * uGrainIntensity;
  }
  a = clamp(a, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col * a, a);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexColor(value: string | undefined, fallback: string): HexColor {
  const source = (value ?? fallback).trim();
  const raw = source[0] === "#" ? source.slice(1) : source;
  const hex = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;

  if (hex.length !== 6) {
    const fallbackBody = (fallback[0] === "#" ? fallback.slice(1) : fallback);
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

function getColorMode(value: unknown): MoltenMetalColorMode {
  return value === "ember" || value === "frost" || value === "molten"
    ? value
    : MOLTEN_METAL_DEFAULTS.colorMode;
}

function colorModeToFloat(mode: MoltenMetalColorMode): number {
  return mode === "ember" ? 1 : mode === "frost" ? 2 : 0;
}

function deriveColor3(base: HexColor, accent: HexColor, params: DynamicEffectParameters): HexColor {
  const mid: HexColor = [
    (base[0] + accent[0]) * 0.5,
    (base[1] + accent[1]) * 0.5,
    (base[2] + accent[2]) * 0.5
  ];

  const contrast = getNumber(params.contrast, 1.2);
  const lighting = getNumber(params.lighting, 0.4);
  const brightness = getNumber(params.brightness, 1.3);
  const c = clamp(contrast, 0.2, 6);
  const l = clamp(lighting, 0, 1);
  const b = clamp(brightness, 0.2, 4);

  return [
    clamp(((mid[0] - 0.5) * c + 0.5) * b + l * 0.18, 0, 1),
    clamp(((mid[1] - 0.5) * c + 0.5) * b + l * 0.18, 0, 1),
    clamp(((mid[2] - 0.5) * c + 0.5) * b + l * 0.18, 0, 1)
  ];
}

function mapSharedSpeed(value: number, fallback: number): number {
  if (value >= 10 && value <= 20) {
    const normalized = clamp((value - 10) / 10, 0, 1);
    return fallback * (0.54 + 1.67 * normalized ** 1.6);
  }
  return value;
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

function resolveSettings(props: MoltenMetalProps): MoltenMetalSettings {
  const params = props.parameters ?? {};
  const from = parseHexColor(props.from, MOLTEN_METAL_DEFAULTS.from);
  const to = parseHexColor(props.to, MOLTEN_METAL_DEFAULTS.to);
  const explicitColor3 = getString(props.color3) ?? getString(params.color3);
  const color3 = explicitColor3
    ? parseHexColor(explicitColor3, MOLTEN_METAL_DEFAULTS.to)
    : deriveColor3(from, to, params);
  const rawSpeed = getNumber(
    getNumber(props.speed, getNumber(params.speed, MOLTEN_METAL_DEFAULTS.speed)),
    MOLTEN_METAL_DEFAULTS.speed
  );
  const speed = mapSharedSpeed(clamp(rawSpeed, MOLTEN_METAL_RANGES.speed.min, 20), MOLTEN_METAL_DEFAULTS.speed);

  return {
    color1: from,
    color2: to,
    color3,
    speed: clamp(speed, MOLTEN_METAL_RANGES.speed.min, MOLTEN_METAL_RANGES.speed.max),
    scale: clamp(getNumber(params.scale, MOLTEN_METAL_DEFAULTS.scale), MOLTEN_METAL_RANGES.scale.min, MOLTEN_METAL_RANGES.scale.max),
    detail: clamp(Math.round(getNumber(params.detail, MOLTEN_METAL_DEFAULTS.detail)), MOLTEN_METAL_RANGES.detail.min, MOLTEN_METAL_RANGES.detail.max),
    glow: clamp(getNumber(params.glow, MOLTEN_METAL_DEFAULTS.glow), MOLTEN_METAL_RANGES.glow.min, MOLTEN_METAL_RANGES.glow.max),
    coreSize: clamp(getNumber(params.coreSize, MOLTEN_METAL_DEFAULTS.coreSize), MOLTEN_METAL_RANGES.coreSize.min, MOLTEN_METAL_RANGES.coreSize.max),
    swirl: clamp(getNumber(params.swirl, MOLTEN_METAL_DEFAULTS.swirl), MOLTEN_METAL_RANGES.swirl.min, MOLTEN_METAL_RANGES.swirl.max),
    fold: clamp(getNumber(params.fold, MOLTEN_METAL_DEFAULTS.fold), MOLTEN_METAL_RANGES.fold.min, MOLTEN_METAL_RANGES.fold.max),
    blackPoint: clamp(getNumber(params.blackPoint, MOLTEN_METAL_DEFAULTS.blackPoint), MOLTEN_METAL_RANGES.blackPoint.min, MOLTEN_METAL_RANGES.blackPoint.max),
    brightness: clamp(getNumber(params.brightness, MOLTEN_METAL_DEFAULTS.brightness), MOLTEN_METAL_RANGES.brightness.min, MOLTEN_METAL_RANGES.brightness.max),
    colorMode: getColorMode(getString(params.colorMode)),
    grain: getBoolean(getBoolean(params.grain, MOLTEN_METAL_DEFAULTS.grain), MOLTEN_METAL_DEFAULTS.grain),
    grainIntensity: clamp(getNumber(params.grainIntensity, MOLTEN_METAL_DEFAULTS.grainIntensity), MOLTEN_METAL_RANGES.grainIntensity.min, MOLTEN_METAL_RANGES.grainIntensity.max),
    mouseInteraction: getBoolean(props.mouseInteraction, getBoolean(params.mouseInteraction, MOLTEN_METAL_DEFAULTS.mouseInteraction)),
    mouseStrength: clamp(getNumber(props.mouseStrength, getNumber(params.mouseStrength, MOLTEN_METAL_DEFAULTS.mouseStrength)), MOLTEN_METAL_RANGES.mouseStrength.min, MOLTEN_METAL_RANGES.mouseStrength.max),
    opacity: clamp(getNumber(params.opacity, MOLTEN_METAL_DEFAULTS.opacity), MOLTEN_METAL_RANGES.opacity.min, MOLTEN_METAL_RANGES.opacity.max)
  };
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("WebGL program allocation failed");
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program) ?? "WebGL link failed";
    gl.deleteProgram(program);
    throw new Error(reason);
  }

  return program;
}

function clampColor(colors: HexColor, index: 0 | 1 | 2): number {
  return clamp(colors[index], 0, 1);
}

function bindPositionBuffer(gl: WebGLRenderingContext, program: WebGLProgram): WebGLBuffer {
  const vertices = new Float32Array([
    -1, -1,
    3, -1,
    -1, 3
  ]);
  const positionBuffer = gl.createBuffer();
  if (!positionBuffer) throw new Error("Failed to create position buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const positionLocation = gl.getAttribLocation(program, "position");
  if (positionLocation < 0) {
    gl.deleteBuffer(positionBuffer);
    throw new Error("position attribute missing");
  }
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  return positionBuffer;
}

export function MoltenMetal({
  className = "dynamic-background",
  ...rest
}: MoltenMetalProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const settings = resolveSettings(rest);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false
    });
    if (!gl) return;

    let disposed = false;
    let frameId = 0;

    let program: WebGLProgram;
    try {
      program = createProgram(gl);
    } catch {
      return;
    }

    const positionBuffer = bindPositionBuffer(gl, program);

    const position = gl.getAttribLocation(program, "position");
    if (position === -1) {
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "iResolution");
    const uTime = gl.getUniformLocation(program, "iTime");
    const uSpeed = gl.getUniformLocation(program, "uSpeed");
    const uScale = gl.getUniformLocation(program, "uScale");
    const uDetail = gl.getUniformLocation(program, "uDetail");
    const uGlow = gl.getUniformLocation(program, "uGlow");
    const uCoreSize = gl.getUniformLocation(program, "uCoreSize");
    const uSwirl = gl.getUniformLocation(program, "uSwirl");
    const uFold = gl.getUniformLocation(program, "uFold");
    const uBlackPoint = gl.getUniformLocation(program, "uBlackPoint");
    const uBrightness = gl.getUniformLocation(program, "uBrightness");
    const uColorMode = gl.getUniformLocation(program, "uColorMode");
    const uGrain = gl.getUniformLocation(program, "uGrain");
    const uGrainIntensity = gl.getUniformLocation(program, "uGrainIntensity");
    const uOpacity = gl.getUniformLocation(program, "uOpacity");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uMouseStrength = gl.getUniformLocation(program, "uMouseStrength");
    const uEnableMouse = gl.getUniformLocation(program, "uEnableMouse");
    const uColor1 = gl.getUniformLocation(program, "uColor1");
    const uColor2 = gl.getUniformLocation(program, "uColor2");
    const uColor3 = gl.getUniformLocation(program, "uColor3");

    if (
      uResolution === null ||
      uTime === null ||
      uSpeed === null ||
      uScale === null ||
      uDetail === null ||
      uGlow === null ||
      uCoreSize === null ||
      uSwirl === null ||
      uFold === null ||
      uBlackPoint === null ||
      uBrightness === null ||
      uColorMode === null ||
      uGrain === null ||
      uGrainIntensity === null ||
      uOpacity === null ||
      uMouse === null ||
      uMouseStrength === null ||
      uEnableMouse === null ||
      uColor1 === null ||
      uColor2 === null ||
      uColor3 === null
    ) {
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      return;
    }

    const currentMouse: [number, number] = [0.5, 0.5];
    const targetMouse: [number, number] = [0.5, 0.5];

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
      gl.uniform2f(uResolution, width, height);
    };

    const setUniforms = () => {
      const c1 = settings.color1;
      const c2 = settings.color2;
      const c3 = settings.color3;
      gl.uniform1f(uSpeed, settings.speed);
      gl.uniform1f(uScale, settings.scale);
      gl.uniform1f(uDetail, settings.detail);
      gl.uniform1f(uGlow, settings.glow);
      gl.uniform1f(uCoreSize, settings.coreSize);
      gl.uniform1f(uSwirl, settings.swirl);
      gl.uniform1f(uFold, settings.fold);
      gl.uniform1f(uBlackPoint, settings.blackPoint);
      gl.uniform1f(uBrightness, settings.brightness);
      gl.uniform1f(uColorMode, colorModeToFloat(settings.colorMode));
      gl.uniform1f(uGrain, settings.grain ? 1 : 0);
      gl.uniform1f(uGrainIntensity, settings.grainIntensity);
      gl.uniform1f(uOpacity, settings.opacity);
      gl.uniform2f(uMouse, currentMouse[0], currentMouse[1]);
      gl.uniform1f(uMouseStrength, settings.mouseStrength);
      gl.uniform1f(uEnableMouse, settings.mouseInteraction ? 1 : 0);
      gl.uniform3f(uColor1, clampColor(c1, 0), clampColor(c1, 1), clampColor(c1, 2));
      gl.uniform3f(uColor2, clampColor(c2, 0), clampColor(c2, 1), clampColor(c2, 2));
      gl.uniform3f(uColor3, clampColor(c3, 0), clampColor(c3, 1), clampColor(c3, 2));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!settings.mouseInteraction) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = 1 - (event.clientY - rect.top) / rect.height;
      targetMouse[0] = clamp(x, 0, 1);
      targetMouse[1] = clamp(y, 0, 1);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!settings.mouseInteraction || !event.touches.length) return;
      const point = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      targetMouse[0] = clamp(((point?.clientX ?? 0) - rect.left) / rect.width, 0, 1);
      targetMouse[1] = clamp(1 - (((point?.clientY ?? 0) - rect.top) / rect.height), 0, 1);
    };

    if (settings.mouseInteraction) {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("touchmove", onTouchMove, { passive: true });
      canvas.style.pointerEvents = "auto";
    } else {
      canvas.style.pointerEvents = "none";
    }

    const render = (time: number) => {
      if (disposed) return;
      currentMouse[0] += (targetMouse[0] - currentMouse[0]) * 0.12;
      currentMouse[1] += (targetMouse[1] - currentMouse[1]) * 0.12;
      setUniforms();
      gl.uniform1f(uTime, time * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopLoop();
      } else {
        startLoop();
      }
    };

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    setUniforms();
    startLoop();

    return () => {
      disposed = true;
      stopLoop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("touchmove", onTouchMove);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, [
    settings.color1,
    settings.color2,
    settings.color3,
    settings.speed,
    settings.scale,
    settings.detail,
    settings.glow,
    settings.coreSize,
    settings.swirl,
    settings.fold,
    settings.blackPoint,
    settings.brightness,
    settings.colorMode,
    settings.grain,
    settings.grainIntensity,
    settings.mouseInteraction,
    settings.mouseStrength,
    settings.opacity,
    className
  ]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default MoltenMetal;
