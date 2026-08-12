import { type ReactElement, useEffect, useRef } from "react";

type DynamicEffectParameterValue = string | number | boolean;
type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;
type Vec2 = [number, number];
type Color = readonly [number, number, number];

type BalatroProps = {
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DynamicEffectParameters;
  color3?: string;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  className?: string;
};

interface BalatroSettings {
  spinRotation: number;
  spinSpeed: number;
  offset: Vec2;
  color1: Color;
  color2: Color;
  color3: Color;
  contrast: number;
  lighting: number;
  spinAmount: number;
  pixelFilter: number;
  spinEase: number;
  isRotate: boolean;
  mouseInteraction: boolean;
  mouseStrength: number;
}

export const BALATRO_DEFAULTS = {
  spinRotation: -2.0,
  spinSpeed: 7.0,
  offset: [0, 0] as Vec2,
  color1: [0xde / 255, 0x44 / 255, 0x3b / 255],
  color2: [0, 0x6b / 255, 0x84 / 255],
  color3: [0x16 / 255, 0x23 / 255, 0x25 / 255],
  contrast: 3.5,
  lighting: 0.4,
  spinAmount: 0.25,
  pixelFilter: 745.0,
  spinEase: 1.0,
  isRotate: false,
  mouseInteraction: true,
  mouseStrength: 1.0
} as const;

export const BALATRO_RANGES = {
  speed: { min: 0.1, max: 20, step: 0.05 },
  spinRotation: { min: -8, max: 8, step: 0.05 },
  contrast: { min: 0.5, max: 6, step: 0.01 },
  lighting: { min: 0.05, max: 1.5, step: 0.01 },
  spinAmount: { min: 0, max: 1, step: 0.01 },
  pixelFilter: { min: 120, max: 1500, step: 1 },
  spinEase: { min: 0, max: 3, step: 0.01 },
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

#define PI 3.14159265359

uniform float iTime;
uniform vec3 iResolution;
uniform float uSpinRotation;
uniform float uSpinSpeed;
uniform vec2 uOffset;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uContrast;
uniform float uLighting;
uniform float uSpinAmount;
uniform float uPixelFilter;
uniform float uSpinEase;
uniform bool uIsRotate;
uniform vec2 uMouse;
uniform float uMouseStrength;

varying vec2 vUv;

vec4 effect(vec2 screenSize, vec2 screen_coords) {
    float pixel_size = length(screenSize.xy) / uPixelFilter;
    vec2 uv = (floor(screen_coords.xy * (1.0 / pixel_size)) * pixel_size - 0.5 * screenSize.xy) / length(screenSize.xy) - uOffset;
    float uv_len = length(uv);

    float speed = (uSpinRotation * uSpinEase * 0.2);
    if(uIsRotate){
       speed = iTime * speed;
    }
    speed += 302.2;

    float mouseInfluence = (uMouse.x * 2.0 - 1.0) * uMouseStrength;
    speed += mouseInfluence * 0.1;

    float new_pixel_angle = atan(uv.y, uv.x) + speed - uSpinEase * 20.0 * (uSpinAmount * uv_len + (1.0 - uSpinAmount));
    vec2 mid = (screenSize.xy / length(screenSize.xy)) / 2.0;
    uv = (vec2(uv_len * cos(new_pixel_angle) + mid.x, uv_len * sin(new_pixel_angle) + mid.y) - mid);

    uv *= 30.0;
    float baseSpeed = iTime * uSpinSpeed;
    speed = baseSpeed + mouseInfluence * 2.0;

    vec2 uv2 = vec2(uv.x + uv.y);

    for(int i = 0; i < 5; i++) {
        uv2 += sin(max(uv.x, uv.y)) + uv;
        uv += 0.5 * vec2(
            cos(5.1123314 + 0.353 * uv2.y + speed * 0.131121),
            sin(uv2.x - 0.113 * speed)
        );
        uv -= cos(uv.x + uv.y) - sin(uv.x * 0.711 - uv.y);
    }

    float contrast_mod = (0.25 * uContrast + 0.5 * uSpinAmount + 1.2);
    float paint_res = min(2.0, max(0.0, length(uv) * 0.035 * contrast_mod));
    float c1p = max(0.0, 1.0 - contrast_mod * abs(1.0 - paint_res));
    float c2p = max(0.0, 1.0 - contrast_mod * abs(paint_res));
    float c3p = 1.0 - min(1.0, c1p + c2p);
    float light = (uLighting - 0.2) * max(c1p * 5.0 - 4.0, 0.0) + uLighting * max(c2p * 5.0 - 4.0, 0.0);

    return vec4((0.3 / uContrast) * uColor1 + (1.0 - 0.3 / uContrast) * (uColor1 * c1p + uColor2 * c2p + vec3(c3p * uColor3)), 1.0) + vec4(light, light, light, 1.0);
}

void main() {
    vec2 uv = vUv * iResolution.xy;
    gl_FragColor = effect(iResolution.xy, uv);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexToColor(value: string | undefined, fallback: Color): Color {
  const source = (value ?? `#${toHex(fallback)}`).trim();
  const raw = source[0] === "#" ? source.slice(1) : source;
  const normalized = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  if (normalized.length !== 6) return fallback;
  const parsed = Number.parseInt(normalized, 16);
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

function deriveColor3(from: Color, to: Color, params: DynamicEffectParameters): Color {
  const contrast = getNumber(params.contrast, BALATRO_DEFAULTS.contrast);
  const lighting = getNumber(params.lighting, BALATRO_DEFAULTS.lighting);
  const brightness = getNumber(params.brightness, 1);
  const base = [
    (from[0] + to[0]) * 0.5,
    (from[1] + to[1]) * 0.5,
    (from[2] + to[2]) * 0.5
  ];
  const tone = clamp((contrast - 1) * 0.08 + lighting * 0.18 + (brightness - 1) * 0.1, 0, 0.8);
  return [
    clamp(base[0] + tone, 0, 1),
    clamp(base[1] + tone, 0, 1),
    clamp(base[2] + tone, 0, 1)
  ];
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

export function resolveBalatroSettings(props: BalatroProps): BalatroSettings {
  const params = props.parameters ?? {};
  const from = parseHexToColor(props.from, BALATRO_DEFAULTS.color1);
  const to = parseHexToColor(props.to, BALATRO_DEFAULTS.color2);
  const explicitColor3 = getString(props.color3) ?? getString(params.color3);
  const color3 = explicitColor3
    ? parseHexToColor(explicitColor3, BALATRO_DEFAULTS.color3)
    : deriveColor3(from, to, params);

  const spinRotation = getNumber(getNumber(params.spinRotation, BALATRO_DEFAULTS.spinRotation), BALATRO_DEFAULTS.spinRotation);
  const contrast = getNumber(getNumber(params.contrast, BALATRO_DEFAULTS.contrast), BALATRO_DEFAULTS.contrast);
  const lighting = getNumber(getNumber(params.lighting, BALATRO_DEFAULTS.lighting), BALATRO_DEFAULTS.lighting);
  const spinAmount = getNumber(getNumber(params.spinAmount, BALATRO_DEFAULTS.spinAmount), BALATRO_DEFAULTS.spinAmount);
  const pixelFilter = getNumber(getNumber(params.pixelFilter, BALATRO_DEFAULTS.pixelFilter), BALATRO_DEFAULTS.pixelFilter);
  const spinEase = getNumber(getNumber(params.spinEase, BALATRO_DEFAULTS.spinEase), BALATRO_DEFAULTS.spinEase);
  const isRotate = getBoolean(getBoolean(params.isRotate, BALATRO_DEFAULTS.isRotate), BALATRO_DEFAULTS.isRotate);

  const rawSpinSpeed = getNumber(
    getNumber(props.speed, getNumber((params as Record<string, number>).spinSpeed, BALATRO_DEFAULTS.spinSpeed)),
    BALATRO_DEFAULTS.spinSpeed
  );
  const spinSpeed = clamp(rawSpinSpeed, BALATRO_RANGES.speed.min, BALATRO_RANGES.speed.max);

  const offsetX = getNumber((params as Record<string, number>).offsetX, BALATRO_DEFAULTS.offset[0]);
  const offsetY = getNumber((params as Record<string, number>).offsetY, BALATRO_DEFAULTS.offset[1]);

  return {
    spinRotation: clamp(spinRotation, BALATRO_RANGES.spinRotation.min, BALATRO_RANGES.spinRotation.max),
    spinSpeed,
    offset: [
      clamp(offsetX, -1, 1),
      clamp(offsetY, -1, 1)
    ],
    color1: from,
    color2: to,
    color3,
    contrast,
    lighting: clamp(lighting, BALATRO_RANGES.lighting.min, BALATRO_RANGES.lighting.max),
    spinAmount: clamp(spinAmount, BALATRO_RANGES.spinAmount.min, BALATRO_RANGES.spinAmount.max),
    pixelFilter: clamp(pixelFilter, BALATRO_RANGES.pixelFilter.min, BALATRO_RANGES.pixelFilter.max),
    spinEase: clamp(spinEase, BALATRO_RANGES.spinEase.min, BALATRO_RANGES.spinEase.max),
    isRotate,
    mouseInteraction: getBoolean(props.mouseInteraction, getBoolean(params.mouseInteraction, BALATRO_DEFAULTS.mouseInteraction)),
    mouseStrength: clamp(getNumber(props.mouseStrength, getNumber((params as Record<string, number>).mouseStrength, BALATRO_DEFAULTS.mouseStrength)), BALATRO_RANGES.mouseStrength.min, BALATRO_RANGES.mouseStrength.max)
  };
}

function colorToHex(color: Color): string {
  return `#${
    Math.round(clamp(color[0], 0, 1) * 255).toString(16).padStart(2, "0")
  }${
    Math.round(clamp(color[1], 0, 1) * 255).toString(16).padStart(2, "0")
  }${
    Math.round(clamp(color[2], 0, 1) * 255).toString(16).padStart(2, "0")
  }`;
}

export function Balatro({
  className = "dynamic-background",
  ...rest
}: BalatroProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = resolveBalatroSettings(rest);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      powerPreference: "low-power"
    });
    if (!gl) return;

    let disposed = false;
    let frameId = 0;
    let program: WebGLProgram;
    let buffer: WebGLBuffer | null;

    try {
      program = createProgram(gl);
      const vertices = new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        -1, 1, 0, 1,
        1, 1, 1, 1
      ]);
      buffer = gl.createBuffer();
      if (!buffer) {
        gl.deleteProgram(program);
        return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    } catch {
      return;
    }

    const position = gl.getAttribLocation(program, "position");
    const uv = gl.getAttribLocation(program, "uv");
    if (position === -1 || uv === -1 || !buffer) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }

    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);

    const uTime = gl.getUniformLocation(program, "iTime");
    const uResolution = gl.getUniformLocation(program, "iResolution");
    const uSpinRotation = gl.getUniformLocation(program, "uSpinRotation");
    const uSpinSpeed = gl.getUniformLocation(program, "uSpinSpeed");
    const uOffset = gl.getUniformLocation(program, "uOffset");
    const uColor1 = gl.getUniformLocation(program, "uColor1");
    const uColor2 = gl.getUniformLocation(program, "uColor2");
    const uColor3 = gl.getUniformLocation(program, "uColor3");
    const uContrast = gl.getUniformLocation(program, "uContrast");
    const uLighting = gl.getUniformLocation(program, "uLighting");
    const uSpinAmount = gl.getUniformLocation(program, "uSpinAmount");
    const uPixelFilter = gl.getUniformLocation(program, "uPixelFilter");
    const uSpinEase = gl.getUniformLocation(program, "uSpinEase");
    const uIsRotate = gl.getUniformLocation(program, "uIsRotate");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uMouseStrength = gl.getUniformLocation(program, "uMouseStrength");
    if (
      !uTime ||
      !uResolution ||
      !uSpinRotation ||
      !uSpinSpeed ||
      !uOffset ||
      !uColor1 ||
      !uColor2 ||
      !uColor3 ||
      !uContrast ||
      !uLighting ||
      !uSpinAmount ||
      !uPixelFilter ||
      !uSpinEase ||
      !uIsRotate ||
      !uMouse ||
      !uMouseStrength
    ) {
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
      const t = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      cursor.x = clamp((t.clientX - rect.left) / rect.width, 0, 1);
      cursor.y = 1 - (t.clientY - rect.top) / rect.height;
    };

    const render = (time: number) => {
      if (disposed) return;
      gl.uniform1f(uTime, time * 0.001);
      gl.uniform3f(uResolution, gl.canvas.width, gl.canvas.height, gl.canvas.width / Math.max(1, gl.canvas.height));
      gl.uniform1f(uSpinRotation, settings.spinRotation);
      gl.uniform1f(uSpinSpeed, settings.spinSpeed);
      gl.uniform2f(uOffset, settings.offset[0], settings.offset[1]);
      gl.uniform3f(uColor1, settings.color1[0], settings.color1[1], settings.color1[2]);
      gl.uniform3f(uColor2, settings.color2[0], settings.color2[1], settings.color2[2]);
      gl.uniform3f(uColor3, settings.color3[0], settings.color3[1], settings.color3[2]);
      gl.uniform1f(uContrast, settings.contrast);
      gl.uniform1f(uLighting, settings.lighting);
      gl.uniform1f(uSpinAmount, settings.spinAmount);
      gl.uniform1f(uPixelFilter, settings.pixelFilter);
      gl.uniform1f(uSpinEase, settings.spinEase);
      gl.uniform1i(uIsRotate, settings.isRotate ? 1 : 0);
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
    settings.spinRotation,
    settings.spinSpeed,
    settings.offset[0],
    settings.offset[1],
    settings.color1[0],
    settings.color1[1],
    settings.color1[2],
    settings.color2[0],
    settings.color2[1],
    settings.color2[2],
    settings.color3[0],
    settings.color3[1],
    settings.color3[2],
    settings.contrast,
    settings.lighting,
    settings.spinAmount,
    settings.pixelFilter,
    settings.spinEase,
    settings.isRotate,
    settings.mouseInteraction,
    settings.mouseStrength,
    className
  ]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default Balatro;
