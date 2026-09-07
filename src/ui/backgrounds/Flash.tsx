import { type ReactElement, useEffect, useRef, useState } from "react";
import { boundedCanvasSize } from "./canvasSizing";
import { createFrameGate } from "./frameBudget";
import { boundedTextureSize, MAX_FLUID_SIM_PIXELS, MAX_FLUID_TEXTURE_PIXELS } from "./resourceBudget";

type DynamicEffectParameterValue = string | number | boolean;
type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;

interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

interface FlashProps {
  className?: string;
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DynamicEffectParameters;
}

export interface FlashSettings {
  simResolution: number;
  dyeResolution: number;
  densityDissipation: number;
  velocityDissipation: number;
  pressure: number;
  curl: number;
  splatRadius: number;
  splatForce: number;
  colorUpdateSpeed: number;
  autoMotion: boolean;
}

export const FLASH_DEFAULTS: FlashSettings = {
  simResolution: 128,
  dyeResolution: 1440,
  densityDissipation: 3.5,
  velocityDissipation: 2.5,
  pressure: 0.1,
  curl: 16,
  splatRadius: 0.65,
  splatForce: 6000,
  colorUpdateSpeed: 25,
  autoMotion: false
};

export const FLASH_RANGES = {
  simResolution: { min: 32, max: 256 },
  dyeResolution: { min: 512, max: 2048 },
  densityDissipation: { min: 0.5, max: 10 },
  velocityDissipation: { min: 0.5, max: 5 },
  pressure: { min: 0, max: 1 },
  curl: { min: 0, max: 30 },
  splatRadius: { min: 0.05, max: 1 },
  splatForce: { min: 1000, max: 20000 },
  colorUpdateSpeed: { min: 1, max: 50 }
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parameterNumber(parameters: DynamicEffectParameters, key: string, fallback: number): number {
  const value = parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parameterBoolean(parameters: DynamicEffectParameters, key: string, fallback: boolean): boolean {
  const value = parameters[key];
  return typeof value === "boolean" ? value : fallback;
}

export const FLASH_AUTO_IDLE_MS = 900;

export interface FlashAutoPointerState {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  phase: number;
}

export function flashAutoPointerStep(state: FlashAutoPointerState, deltaSeconds: number): FlashAutoPointerState {
  const delta = clamp(deltaSeconds, 0, 1 / 30);
  const phase = state.phase + delta;
  // The main path deliberately sweeps horizontally from edge to edge. The
  // vertical waves turn each pass into a curved stroke without shortening it.
  const sweep = phase * 0.48;
  const curveX = 0.5 + Math.sin(sweep) * 0.38;
  const curveY = 0.5 + Math.sin(sweep * 2) * 0.17 + Math.sin(sweep * 4) * 0.055;
  const edgeX = state.x < 0.18 ? (0.18 - state.x) * 18 : state.x > 0.82 ? (0.82 - state.x) * 18 : 0;
  const edgeY = state.y < 0.18 ? (0.18 - state.y) * 18 : state.y > 0.82 ? (0.82 - state.y) * 18 : 0;
  const steeringX = (clamp(curveX, 0.12, 0.88) - state.x) * 5.4 + edgeX;
  const steeringY = (clamp(curveY, 0.12, 0.88) - state.y) * 5.4 + edgeY;
  const steeringLength = Math.max(0.0001, Math.hypot(steeringX, steeringY));
  const speed = 0.2 + Math.sin(phase * 0.43) * 0.025;
  const targetVelocityX = (steeringX / steeringLength) * speed;
  const targetVelocityY = (steeringY / steeringLength) * speed;
  const velocityBlend = 1 - Math.exp(-delta * 2.2);
  let velocityX = state.velocityX + (targetVelocityX - state.velocityX) * velocityBlend;
  let velocityY = state.velocityY + (targetVelocityY - state.velocityY) * velocityBlend;
  const unclampedX = state.x + velocityX * delta;
  const unclampedY = state.y + velocityY * delta;
  const x = clamp(unclampedX, 0.08, 0.92);
  const y = clamp(unclampedY, 0.08, 0.92);
  if (x !== unclampedX) velocityX = x === 0.08 ? Math.abs(velocityX) : -Math.abs(velocityX);
  if (y !== unclampedY) velocityY = y === 0.08 ? Math.abs(velocityY) : -Math.abs(velocityY);
  return { x, y, velocityX, velocityY, phase };
}

export function resolveFlashSettings({ speed, parameters = {} }: FlashProps = {}): FlashSettings {
  const resolve = (key: keyof typeof FLASH_RANGES, fallback: number, integer = false) => {
    const range = FLASH_RANGES[key];
    const value =
      key === "colorUpdateSpeed" ? (typeof speed === "number" && Number.isFinite(speed) ? speed : fallback) : parameterNumber(parameters, key, fallback);
    const bounded = clamp(value, range.min, range.max);
    return integer ? Math.round(bounded) : bounded;
  };

  return {
    simResolution: resolve("simResolution", FLASH_DEFAULTS.simResolution, true),
    dyeResolution: resolve("dyeResolution", FLASH_DEFAULTS.dyeResolution, true),
    densityDissipation: resolve("densityDissipation", FLASH_DEFAULTS.densityDissipation),
    velocityDissipation: resolve("velocityDissipation", FLASH_DEFAULTS.velocityDissipation),
    pressure: resolve("pressure", FLASH_DEFAULTS.pressure),
    curl: resolve("curl", FLASH_DEFAULTS.curl, true),
    splatRadius: resolve("splatRadius", FLASH_DEFAULTS.splatRadius),
    splatForce: resolve("splatForce", FLASH_DEFAULTS.splatForce, true),
    colorUpdateSpeed: resolve("colorUpdateSpeed", FLASH_DEFAULTS.colorUpdateSpeed, true),
    autoMotion: parameterBoolean(parameters, "autoMotion", FLASH_DEFAULTS.autoMotion)
  };
}

interface Pointer {
  id: number;
  texcoordX: number;
  texcoordY: number;
  prevTexcoordX: number;
  prevTexcoordY: number;
  deltaX: number;
  deltaY: number;
  down: boolean;
  moved: boolean;
  color: ColorRGB;
}

interface TextureFormat {
  internalFormat: number;
  format: number;
}

function pointerPrototype(): Pointer {
  return {
    id: -1,
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    down: false,
    moved: false,
    color: { r: 0, g: 0, b: 0 }
  };
}

export function Flash({ className = "dynamic-background", ...props }: FlashProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const automaticPointerRef = useRef<FlashAutoPointerState>({ x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, phase: 0 });
  const lastPointerPositionRef = useRef<{ x: number; y: number; initialized: boolean }>({ x: 0.5, y: 0.5, initialized: false });
  const lastHumanInputTimeRef = useRef(Number.NEGATIVE_INFINITY);
  const settings = resolveFlashSettings(props);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const startLoopRef = useRef<(() => void) | null>(null);
  const [contextGeneration, setContextGeneration] = useState(0);
  const { simResolution: SIM_RESOLUTION, dyeResolution: DYE_RESOLUTION, autoMotion: AUTO_MOTION } = settings;
  const PRESSURE_ITERATIONS = 20;
  const SHADING = true;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointers: Pointer[] = [pointerPrototype()];

    const config = {
      SIM_RESOLUTION,
      DYE_RESOLUTION,
      DENSITY_DISSIPATION: settingsRef.current.densityDissipation,
      VELOCITY_DISSIPATION: settingsRef.current.velocityDissipation,
      PRESSURE: settingsRef.current.pressure,
      PRESSURE_ITERATIONS,
      CURL: settingsRef.current.curl,
      SPLAT_RADIUS: settingsRef.current.splatRadius,
      SPLAT_FORCE: settingsRef.current.splatForce,
      SHADING,
      COLOR_UPDATE_SPEED: settingsRef.current.colorUpdateSpeed
    };

    let context: ReturnType<typeof getWebGLContext>;
    try {
      context = getWebGLContext(canvas);
    } catch {
      return;
    }
    const { gl, ext } = context;

    if (!ext.supportLinearFiltering) {
      config.DYE_RESOLUTION = 256;
      config.SHADING = false;
    }

    function getWebGLContext(canvas: HTMLCanvasElement) {
      const params = {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false
      };

      let gl = canvas.getContext("webgl2", params) as WebGL2RenderingContext | null;

      if (!gl) {
        gl = (canvas.getContext("webgl", params) || canvas.getContext("experimental-webgl", params)) as WebGL2RenderingContext | null;
      }

      if (!gl) {
        throw new Error("Unable to initialize WebGL.");
      }

      const isWebGL2 = "drawBuffers" in gl;

      let halfFloat: OES_texture_half_float | null = null;

      if (isWebGL2) {
        (gl as WebGL2RenderingContext).getExtension("EXT_color_buffer_float");
      } else {
        halfFloat = gl.getExtension("OES_texture_half_float");
      }
      const supportLinearFiltering = !!gl.getExtension(isWebGL2 ? "OES_texture_float_linear" : "OES_texture_half_float_linear");

      gl.clearColor(0, 0, 0, 1);

      const halfFloatTexType = isWebGL2 ? (gl as WebGL2RenderingContext).HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES) || 0;

      let formatRGBA: TextureFormat | null;
      let formatRG: TextureFormat | null;
      let formatR: TextureFormat | null;

      if (isWebGL2) {
        formatRGBA = getSupportedFormat(gl, (gl as WebGL2RenderingContext).RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, (gl as WebGL2RenderingContext).RG16F, (gl as WebGL2RenderingContext).RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, (gl as WebGL2RenderingContext).R16F, (gl as WebGL2RenderingContext).RED, halfFloatTexType);
      } else {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      }

      if (!formatRGBA || !formatRG || !formatR) {
        throw new Error("Unable to initialize WebGL render texture formats.");
      }

      return {
        gl,
        ext: {
          formatRGBA,
          formatRG,
          formatR,
          halfFloatTexType,
          supportLinearFiltering
        }
      };
    }

    function getSupportedFormat(
      gl: WebGLRenderingContext | WebGL2RenderingContext,
      internalFormat: number,
      format: number,
      type: number
    ): TextureFormat | null {
      if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
        if ("drawBuffers" in gl) {
          const gl2 = gl as WebGL2RenderingContext;
          switch (internalFormat) {
            case gl2.R16F:
              return getSupportedFormat(gl2, gl2.RG16F, gl2.RG, type);
            case gl2.RG16F:
              return getSupportedFormat(gl2, gl2.RGBA16F, gl2.RGBA, type);
            default:
              return null;
          }
        }
        return null;
      }
      return { internalFormat, format };
    }

    function supportRenderTextureFormat(gl: WebGLRenderingContext | WebGL2RenderingContext, internalFormat: number, format: number, type: number) {
      const texture = gl.createTexture();
      if (!texture) return false;

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

      const fbo = gl.createFramebuffer();
      if (!fbo) return false;

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
      return status === gl.FRAMEBUFFER_COMPLETE;
    }

    function hashCode(s: string) {
      if (!s.length) return 0;
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0;
      }
      return hash;
    }

    function addKeywords(source: string, keywords: string[] | null) {
      if (!keywords) return source;
      let keywordsString = "";
      for (const keyword of keywords) {
        keywordsString += `#define ${keyword}\n`;
      }
      return keywordsString + source;
    }

    function compileShader(type: number, source: string, keywords: string[] | null = null): WebGLShader | null {
      const shaderSource = addKeywords(source, keywords);
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, shaderSource);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.trace(gl.getShaderInfoLog(shader));
      }
      return shader;
    }

    function createProgram(vertexShader: WebGLShader | null, fragmentShader: WebGLShader | null): WebGLProgram | null {
      if (!vertexShader || !fragmentShader) return null;
      const program = gl.createProgram();
      if (!program) return null;
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.trace(gl.getProgramInfoLog(program));
      }
      return program;
    }

    function getUniforms(program: WebGLProgram) {
      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < uniformCount; i++) {
        const uniformInfo = gl.getActiveUniform(program, i);
        if (uniformInfo) {
          uniforms[uniformInfo.name] = gl.getUniformLocation(program, uniformInfo.name);
        }
      }
      return uniforms;
    }

    class Program {
      program: WebGLProgram | null;
      uniforms: Record<string, WebGLUniformLocation | null>;

      constructor(vertexShader: WebGLShader | null, fragmentShader: WebGLShader | null) {
        this.program = createProgram(vertexShader, fragmentShader);
        this.uniforms = this.program ? getUniforms(this.program) : {};
      }

      bind() {
        if (this.program) gl.useProgram(this.program);
      }
    }

    class Material {
      vertexShader: WebGLShader | null;
      fragmentShaderSource: string;
      programs: Record<number, WebGLProgram | null>;
      activeProgram: WebGLProgram | null;
      uniforms: Record<string, WebGLUniformLocation | null>;

      constructor(vertexShader: WebGLShader | null, fragmentShaderSource: string) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = {};
        this.activeProgram = null;
        this.uniforms = {};
      }

      setKeywords(keywords: string[]) {
        let hash = 0;
        for (const kw of keywords) {
          hash += hashCode(kw);
        }
        let program = this.programs[hash];
        if (program == null) {
          const fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
          program = createProgram(this.vertexShader, fragmentShader);
          if (fragmentShader) gl.deleteShader(fragmentShader);
          this.programs[hash] = program;
        }
        if (program === this.activeProgram) return;
        if (program) {
          this.uniforms = getUniforms(program);
        }
        this.activeProgram = program;
      }

      bind() {
        if (this.activeProgram) {
          gl.useProgram(this.activeProgram);
        }
      }
    }

    const baseVertexShader = compileShader(
      gl.VERTEX_SHADER,
      `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;

      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `
    );

    const copyShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;

      void main () {
          gl_FragColor = texture2D(uTexture, vUv);
      }
    `
    );

    const clearShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;

      void main () {
          gl_FragColor = value * texture2D(uTexture, vUv);
      }
    `
    );

    const displayShaderSource = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform sampler2D uDithering;
      uniform vec2 ditherScale;
      uniform vec2 texelSize;

      vec3 linearToGamma (vec3 color) {
          color = max(color, vec3(0));
          return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
      }

      void main () {
          vec3 c = texture2D(uTexture, vUv).rgb;
          #ifdef SHADING
              vec3 lc = texture2D(uTexture, vL).rgb;
              vec3 rc = texture2D(uTexture, vR).rgb;
              vec3 tc = texture2D(uTexture, vT).rgb;
              vec3 bc = texture2D(uTexture, vB).rgb;

              float dx = length(rc) - length(lc);
              float dy = length(tc) - length(bc);

              vec3 n = normalize(vec3(dx, dy, length(texelSize)));
              vec3 l = vec3(0.0, 0.0, 1.0);

              float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
              c *= diffuse;
          #endif

          float a = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c, a);
      }
    `;

    const splatShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;

      void main () {
          vec2 p = vUv - point.xy;
          p.x *= aspectRatio;
          vec3 splat = exp(-dot(p, p) / radius) * color;
          vec3 base = texture2D(uTarget, vUv).xyz;
          gl_FragColor = vec4(base + splat, 1.0);
      }
    `
    );

    const advectionShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform vec2 dyeTexelSize;
      uniform float dt;
      uniform float dissipation;

      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
          vec2 st = uv / tsize - 0.5;
          vec2 iuv = floor(st);
          vec2 fuv = fract(st);

          vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
          vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
          vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
          vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

          return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
      }

      void main () {
          #ifdef MANUAL_FILTERING
              vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
              vec4 result = bilerp(uSource, coord, dyeTexelSize);
          #else
              vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
              vec4 result = texture2D(uSource, coord);
          #endif
          float decay = 1.0 + dissipation * dt;
          gl_FragColor = result / decay;
      }
    `,
      ext.supportLinearFiltering ? null : ["MANUAL_FILTERING"]
    );

    const divergenceShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;

      void main () {
          float L = texture2D(uVelocity, vL).x;
          float R = texture2D(uVelocity, vR).x;
          float T = texture2D(uVelocity, vT).y;
          float B = texture2D(uVelocity, vB).y;

          vec2 C = texture2D(uVelocity, vUv).xy;
          if (vL.x < 0.0) { L = -C.x; }
          if (vR.x > 1.0) { R = -C.x; }
          if (vT.y > 1.0) { T = -C.y; }
          if (vB.y < 0.0) { B = -C.y; }

          float div = 0.5 * (R - L + T - B);
          gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `
    );

    const curlShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;

      void main () {
          float L = texture2D(uVelocity, vL).y;
          float R = texture2D(uVelocity, vR).y;
          float T = texture2D(uVelocity, vT).x;
          float B = texture2D(uVelocity, vB).x;
          float vorticity = R - L - T + B;
          gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `
    );

    const vorticityShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;

      void main () {
          float L = texture2D(uCurl, vL).x;
          float R = texture2D(uCurl, vR).x;
          float T = texture2D(uCurl, vT).x;
          float B = texture2D(uCurl, vB).x;
          float C = texture2D(uCurl, vUv).x;

          vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
          force /= length(force) + 0.0001;
          force *= curl * C;
          force.y *= -1.0;

          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity += force * dt;
          velocity = min(max(velocity, -1000.0), 1000.0);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `
    );

    const pressureShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;

      void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          float C = texture2D(uPressure, vUv).x;
          float divergence = texture2D(uDivergence, vUv).x;
          float pressure = (L + R + B + T - divergence) * 0.25;
          gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `
    );

    const gradientSubtractShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;

      void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity.xy -= vec2(R - L, T - B);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `
    );

    const blitBuffer = gl.createBuffer()!;
    const blitElementBuffer = gl.createBuffer()!;
    const blit = (() => {
      gl.bindBuffer(gl.ARRAY_BUFFER, blitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, blitElementBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);

      return (target: FBO | null, doClear = false) => {
        if (!gl) return;
        if (!target) {
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
          gl.viewport(0, 0, target.width, target.height);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (doClear) {
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      };
    })();

    interface FBO {
      texture: WebGLTexture;
      fbo: WebGLFramebuffer;
      width: number;
      height: number;
      texelSizeX: number;
      texelSizeY: number;
      attach: (id: number) => number;
    }

    interface DoubleFBO {
      width: number;
      height: number;
      texelSizeX: number;
      texelSizeY: number;
      read: FBO;
      write: FBO;
      swap: () => void;
    }

    let dye: DoubleFBO;
    let velocity: DoubleFBO;
    let divergence: FBO;
    let curl: FBO;
    let pressure: DoubleFBO;
    let framebuffersReady = false;

    const copyProgram = new Program(baseVertexShader, copyShader);
    const clearProgram = new Program(baseVertexShader, clearShader);
    const splatProgram = new Program(baseVertexShader, splatShader);
    const advectionProgram = new Program(baseVertexShader, advectionShader);
    const divergenceProgram = new Program(baseVertexShader, divergenceShader);
    const curlProgram = new Program(baseVertexShader, curlShader);
    const vorticityProgram = new Program(baseVertexShader, vorticityShader);
    const pressureProgram = new Program(baseVertexShader, pressureShader);
    const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
    const displayMaterial = new Material(baseVertexShader, displayShaderSource);

    function createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): FBO {
      gl.activeTexture(gl.TEXTURE0);
      const texture = gl.createTexture();
      if (!texture) throw new Error("Fluid texture allocation failed.");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      if (!fbo) {
        gl.deleteTexture(texture);
        throw new Error("Fluid framebuffer allocation failed.");
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteTexture(texture);
        gl.deleteFramebuffer(fbo);
        throw new Error("Fluid framebuffer is incomplete.");
      }
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const texelSizeX = 1 / w;
      const texelSizeY = 1 / h;

      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach(id: number) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        }
      };
    }

    function createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): DoubleFBO {
      const fbo1 = createFBO(w, h, internalFormat, format, type, param);
      const fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        read: fbo1,
        write: fbo2,
        swap() {
          const tmp = this.read;
          this.read = this.write;
          this.write = tmp;
        }
      };
    }

    function deleteFBO(target: FBO): void {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.fbo);
    }

    function deleteDoubleFBO(target: DoubleFBO): void {
      deleteFBO(target.read);
      deleteFBO(target.write);
    }

    function resizeFBO(target: FBO, w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param);
      copyProgram.bind();
      if (copyProgram.uniforms.uTexture) gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
      blit(newFBO, false);
      deleteFBO(target);
      return newFBO;
    }

    function resizeDoubleFBO(target: DoubleFBO, w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      if (target.width === w && target.height === h) return target;
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
      deleteFBO(target.write);
      target.write = createFBO(w, h, internalFormat, format, type, param);
      target.width = w;
      target.height = h;
      target.texelSizeX = 1 / w;
      target.texelSizeY = 1 / h;
      return target;
    }

    function initFramebuffers() {
      try {
        const simRes = getResolution(config.SIM_RESOLUTION!, MAX_FLUID_SIM_PIXELS);
        const dyeRes = getResolution(config.DYE_RESOLUTION!);

        const texType = ext.halfFloatTexType;
        const rgba = ext.formatRGBA;
        const rg = ext.formatRG;
        const r = ext.formatR;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
        gl.disable(gl.BLEND);

        if (!dye) {
          dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        } else {
          dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        }

        if (!velocity) {
          velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        } else {
          velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        }

        if (framebuffersReady) {
          deleteFBO(divergence);
          deleteFBO(curl);
          deleteDoubleFBO(pressure);
        }
        divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        framebuffersReady = true;
        return true;
      } catch {
        // Release partially allocated GPU resources and leave the static fallback visible.
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return false;
      }
    }

    function updateKeywords() {
      const displayKeywords: string[] = [];
      if (config.SHADING) displayKeywords.push("SHADING");
      displayMaterial.setKeywords(displayKeywords);
    }

    function getResolution(resolution: number, pixelBudget = MAX_FLUID_TEXTURE_PIXELS) {
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const aspectRatio = w / h;
      const aspect = aspectRatio < 1 ? 1 / aspectRatio : aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspect);
      const reportedLimit: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const limit = typeof reportedLimit === "number" && reportedLimit > 0 ? reportedLimit : 4096;
      if (w > h) {
        return boundedTextureSize(max, min, limit, pixelBudget);
      }
      return boundedTextureSize(min, max, limit, pixelBudget);
    }

    resizeCanvas();
    updateKeywords();
    if (!initFramebuffers()) return;

    let lastUpdateTime = Date.now();
    let colorUpdateTimer = 0.0;
    let animationFrameId: number | null = null;
    let disposed = false;
    let simulationStarted = false;
    let pointerInitialized = false;
    let lastHumanInputTime = lastHumanInputTimeRef.current;
    let automaticPointerActive = false;
    let automaticPointer = automaticPointerRef.current;
    let idleSimulationSeconds = 0;
    const canDraw = createFrameGate();

    function updateFrame(timestamp: number) {
      animationFrameId = null;
      if (disposed || document.visibilityState === "hidden") return;
      if (!canDraw(timestamp)) {
        animationFrameId = window.requestAnimationFrame(updateFrame);
        return;
      }
      const current = settingsRef.current;
      config.DENSITY_DISSIPATION = current.densityDissipation;
      config.VELOCITY_DISSIPATION = current.velocityDissipation;
      config.PRESSURE = current.pressure;
      config.CURL = current.curl;
      config.SPLAT_RADIUS = current.splatRadius;
      config.SPLAT_FORCE = current.splatForce;
      config.COLOR_UPDATE_SPEED = current.colorUpdateSpeed;
      const dt = calcDeltaTime();
      if (resizeCanvas() && !initFramebuffers()) return;
      idleSimulationSeconds += dt;
      updateAutomaticPointer(dt);
      updateColors(dt);
      applyInputs();
      step(dt);
      render(null);
      // Conservative dissipation horizon; count simulated time, never time spent hidden.
      if (!current.autoMotion && idleSimulationSeconds > 12 / Math.min(current.densityDissipation, current.velocityDissipation)) {
        simulationStarted = false;
        return;
      }
      animationFrameId = window.requestAnimationFrame(updateFrame);
    }

    function startLoop() {
      simulationStarted = true;
      if (disposed || document.visibilityState === "hidden" || animationFrameId !== null) return;
      lastUpdateTime = Date.now();
      animationFrameId = window.requestAnimationFrame(updateFrame);
    }

    function stopLoop() {
      if (animationFrameId === null) return;
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    function calcDeltaTime() {
      const now = Date.now();
      let dt = (now - lastUpdateTime) / 1000;
      dt = Math.max(0, Math.min(dt, 0.016666));
      lastUpdateTime = now;
      return dt;
    }

    function resizeCanvas() {
      const { width, height } = boundedCanvasSize(canvas!.clientWidth, canvas!.clientHeight);
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
        return true;
      }
      return false;
    }

    function pointerPosition(clientX: number, clientY: number): { x: number; y: number } {
      const bounds = canvas!.getBoundingClientRect();
      return {
        x: ((clientX - bounds.left) * canvas!.width) / Math.max(1, bounds.width),
        y: ((clientY - bounds.top) * canvas!.height) / Math.max(1, bounds.height)
      };
    }

    function updateAutomaticPointer(deltaSeconds: number) {
      if (!settingsRef.current.autoMotion || performance.now() - lastHumanInputTime < FLASH_AUTO_IDLE_MS) {
        automaticPointerActive = false;
        return;
      }

      const pointer = pointers[0];
      if (!automaticPointerActive) {
        const x = pointerInitialized ? pointer.texcoordX : lastPointerPositionRef.current.initialized ? lastPointerPositionRef.current.x : automaticPointer.x;
        const y = pointerInitialized
          ? 1 - pointer.texcoordY
          : lastPointerPositionRef.current.initialized
            ? lastPointerPositionRef.current.y
            : automaticPointer.y;
        automaticPointer = { ...automaticPointer, x, y, velocityX: 0, velocityY: 0 };
        automaticPointerRef.current = automaticPointer;
        if (!pointerInitialized) {
          updatePointerDownData(pointer, -1, x * canvas!.width, y * canvas!.height);
          pointer.down = false;
          pointerInitialized = true;
        }
        automaticPointerActive = true;
      }

      automaticPointer = flashAutoPointerStep(automaticPointer, deltaSeconds);
      automaticPointerRef.current = automaticPointer;
      updatePointerMoveData(pointer, automaticPointer.x * canvas!.width, automaticPointer.y * canvas!.height, pointer.color);
    }

    function beginHumanInput(): boolean {
      const interruptedAutomaticPointer = automaticPointerActive;
      automaticPointerActive = false;
      lastHumanInputTime = performance.now();
      lastHumanInputTimeRef.current = lastHumanInputTime;
      return interruptedAutomaticPointer;
    }

    function updateColors(dt: number) {
      colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
      if (colorUpdateTimer >= 1) {
        colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
        pointers.forEach((p) => {
          p.color = generateColor();
        });
      }
    }

    function applyInputs() {
      for (const p of pointers) {
        if (p.moved) {
          p.moved = false;
          splatPointer(p);
        }
      }
    }

    function step(dt: number) {
      gl.disable(gl.BLEND);

      curlProgram.bind();
      if (curlProgram.uniforms.texelSize) {
        gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      if (curlProgram.uniforms.uVelocity) {
        gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
      }
      blit(curl);

      vorticityProgram.bind();
      if (vorticityProgram.uniforms.texelSize) {
        gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      if (vorticityProgram.uniforms.uVelocity) {
        gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
      }
      if (vorticityProgram.uniforms.uCurl) {
        gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
      }
      if (vorticityProgram.uniforms.curl) {
        gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
      }
      if (vorticityProgram.uniforms.dt) {
        gl.uniform1f(vorticityProgram.uniforms.dt, dt);
      }
      blit(velocity.write);
      velocity.swap();

      divergenceProgram.bind();
      if (divergenceProgram.uniforms.texelSize) {
        gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      if (divergenceProgram.uniforms.uVelocity) {
        gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
      }
      blit(divergence);

      clearProgram.bind();
      if (clearProgram.uniforms.uTexture) {
        gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
      }
      if (clearProgram.uniforms.value) {
        gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
      }
      blit(pressure.write);
      pressure.swap();

      pressureProgram.bind();
      if (pressureProgram.uniforms.texelSize) {
        gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      if (pressureProgram.uniforms.uDivergence) {
        gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
      }
      for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        if (pressureProgram.uniforms.uPressure) {
          gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        }
        blit(pressure.write);
        pressure.swap();
      }

      gradienSubtractProgram.bind();
      if (gradienSubtractProgram.uniforms.texelSize) {
        gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      if (gradienSubtractProgram.uniforms.uPressure) {
        gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
      }
      if (gradienSubtractProgram.uniforms.uVelocity) {
        gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
      }
      blit(velocity.write);
      velocity.swap();

      advectionProgram.bind();
      if (advectionProgram.uniforms.texelSize) {
        gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      if (!ext.supportLinearFiltering && advectionProgram.uniforms.dyeTexelSize) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      const velocityId = velocity.read.attach(0);
      if (advectionProgram.uniforms.uVelocity) {
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
      }
      if (advectionProgram.uniforms.uSource) {
        gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
      }
      if (advectionProgram.uniforms.dt) {
        gl.uniform1f(advectionProgram.uniforms.dt, dt);
      }
      if (advectionProgram.uniforms.dissipation) {
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
      }
      blit(velocity.write);
      velocity.swap();

      if (!ext.supportLinearFiltering && advectionProgram.uniforms.dyeTexelSize) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
      }
      if (advectionProgram.uniforms.uVelocity) {
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
      }
      if (advectionProgram.uniforms.uSource) {
        gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
      }
      if (advectionProgram.uniforms.dissipation) {
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
      }
      blit(dye.write);
      dye.swap();
    }

    function render(target: FBO | null) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      drawDisplay(target);
    }

    function drawDisplay(target: FBO | null) {
      const width = target ? target.width : gl.drawingBufferWidth;
      const height = target ? target.height : gl.drawingBufferHeight;
      displayMaterial.bind();
      if (config.SHADING && displayMaterial.uniforms.texelSize) {
        gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / width, 1 / height);
      }
      if (displayMaterial.uniforms.uTexture) {
        gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
      }
      blit(target, false);
    }

    function splatPointer(pointer: Pointer) {
      const dx = pointer.deltaX * config.SPLAT_FORCE;
      const dy = pointer.deltaY * config.SPLAT_FORCE;
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    }

    function clickSplat(pointer: Pointer) {
      const color = generateColor();
      color.r *= 10;
      color.g *= 10;
      color.b *= 10;
      const dx = 10 * (Math.random() - 0.5);
      const dy = 30 * (Math.random() - 0.5);
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
    }

    function splat(x: number, y: number, dx: number, dy: number, color: ColorRGB) {
      idleSimulationSeconds = 0;
      splatProgram.bind();
      if (splatProgram.uniforms.uTarget) {
        gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
      }
      if (splatProgram.uniforms.aspectRatio) {
        gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas!.width / canvas!.height);
      }
      if (splatProgram.uniforms.point) {
        gl.uniform2f(splatProgram.uniforms.point, x, y);
      }
      if (splatProgram.uniforms.color) {
        gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
      }
      if (splatProgram.uniforms.radius) {
        gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100)!);
      }
      blit(velocity.write);
      velocity.swap();

      if (splatProgram.uniforms.uTarget) {
        gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
      }
      if (splatProgram.uniforms.color) {
        gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
      }
      blit(dye.write);
      dye.swap();
    }

    function correctRadius(radius: number) {
      const aspectRatio = canvas!.width / canvas!.height;
      if (aspectRatio > 1) radius *= aspectRatio;
      return radius;
    }

    function updatePointerDownData(pointer: Pointer, id: number, posX: number, posY: number) {
      pointer.id = id;
      pointer.down = true;
      pointer.moved = false;
      pointer.texcoordX = posX / canvas!.width;
      pointer.texcoordY = 1 - posY / canvas!.height;
      pointer.prevTexcoordX = pointer.texcoordX;
      pointer.prevTexcoordY = pointer.texcoordY;
      pointer.deltaX = 0;
      pointer.deltaY = 0;
      pointer.color = generateColor();
      lastPointerPositionRef.current = { x: pointer.texcoordX, y: 1 - pointer.texcoordY, initialized: true };
    }

    function updatePointerMoveData(pointer: Pointer, posX: number, posY: number, color: ColorRGB) {
      pointer.prevTexcoordX = pointer.texcoordX;
      pointer.prevTexcoordY = pointer.texcoordY;
      pointer.texcoordX = posX / canvas!.width;
      pointer.texcoordY = 1 - posY / canvas!.height;
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX)!;
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY)!;
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
      pointer.color = color;
      lastPointerPositionRef.current = { x: pointer.texcoordX, y: 1 - pointer.texcoordY, initialized: true };
    }

    function updatePointerUpData(pointer: Pointer) {
      pointer.down = false;
    }

    function correctDeltaX(delta: number) {
      const aspectRatio = canvas!.width / canvas!.height;
      if (aspectRatio < 1) delta *= aspectRatio;
      return delta;
    }

    function correctDeltaY(delta: number) {
      const aspectRatio = canvas!.width / canvas!.height;
      if (aspectRatio > 1) delta /= aspectRatio;
      return delta;
    }

    function generateColor(): ColorRGB {
      const c = HSVtoRGB(Math.random(), 1.0, 1.0);
      c.r *= 0.15;
      c.g *= 0.15;
      c.b *= 0.15;
      return c;
    }

    function HSVtoRGB(h: number, s: number, v: number): ColorRGB {
      let r = 0,
        g = 0,
        b = 0;
      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);

      switch (i % 6) {
        case 0:
          r = v;
          g = t;
          b = p;
          break;
        case 1:
          r = q;
          g = v;
          b = p;
          break;
        case 2:
          r = p;
          g = v;
          b = t;
          break;
        case 3:
          r = p;
          g = q;
          b = v;
          break;
        case 4:
          r = t;
          g = p;
          b = v;
          break;
        case 5:
          r = v;
          g = p;
          b = q;
          break;
      }
      return { r, g, b };
    }

    function wrap(value: number, min: number, max: number) {
      const range = max - min;
      if (range === 0) return min;
      return ((value - min) % range) + min;
    }

    function isUiInputTarget(target: EventTarget | null): boolean {
      return (
        target instanceof Element &&
        target.closest("button, input, textarea, select, a, [contenteditable='true'], [role='button'], [role='listbox'], [role='option'], [role='slider']") !==
          null
      );
    }

    function handleMouseDown(event: MouseEvent) {
      if (isUiInputTarget(event.target)) return;
      const pointer = pointers[0];
      const position = pointerPosition(event.clientX, event.clientY);
      beginHumanInput();
      updatePointerDownData(pointer, -1, position.x, position.y);
      pointerInitialized = true;
      clickSplat(pointer);
      startLoop();
    }

    function handleMouseMove(event: MouseEvent) {
      if (isUiInputTarget(event.target)) return;
      const pointer = pointers[0];
      const position = pointerPosition(event.clientX, event.clientY);
      const interruptedAutomaticPointer = beginHumanInput();
      if (!pointerInitialized || interruptedAutomaticPointer) {
        updatePointerDownData(pointer, -1, position.x, position.y);
        pointer.down = false;
        pointerInitialized = true;
      } else {
        updatePointerMoveData(pointer, position.x, position.y, pointer.color);
      }
      startLoop();
    }

    function handleTouchStart(event: TouchEvent) {
      if (isUiInputTarget(event.target)) return;
      const touch = event.targetTouches[0];
      if (!touch) return;
      const pointer = pointers[0];
      const position = pointerPosition(touch.clientX, touch.clientY);
      beginHumanInput();
      updatePointerDownData(pointer, touch.identifier, position.x, position.y);
      pointerInitialized = true;
      startLoop();
    }

    function handleTouchMove(event: TouchEvent) {
      if (isUiInputTarget(event.target)) return;
      const touch = event.targetTouches[0];
      if (!touch) return;
      const pointer = pointers[0];
      const position = pointerPosition(touch.clientX, touch.clientY);
      const interruptedAutomaticPointer = beginHumanInput();
      if (!pointerInitialized || interruptedAutomaticPointer) {
        updatePointerDownData(pointer, touch.identifier, position.x, position.y);
        pointer.down = true;
        pointerInitialized = true;
      } else {
        updatePointerMoveData(pointer, position.x, position.y, pointer.color);
      }
      startLoop();
    }

    function handleTouchEnd() {
      updatePointerUpData(pointers[0]);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        stopLoop();
      } else if (simulationStarted) {
        startLoop();
      }
    }

    function handleResize() {
      if (resizeCanvas() && !initFramebuffers()) stopLoop();
    }

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      stopLoop();
    };
    const handleContextRestored = () => setContextGeneration((current) => current + 1);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    startLoopRef.current = startLoop;
    if (settingsRef.current.autoMotion) startLoop();

    return () => {
      disposed = true;
      startLoopRef.current = null;
      stopLoop();
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);

      if (framebuffersReady) {
        deleteDoubleFBO(dye);
        deleteDoubleFBO(velocity);
        deleteFBO(divergence);
        deleteFBO(curl);
        deleteDoubleFBO(pressure);
      }
      for (const resource of [
        copyProgram,
        clearProgram,
        splatProgram,
        advectionProgram,
        divergenceProgram,
        curlProgram,
        vorticityProgram,
        pressureProgram,
        gradienSubtractProgram
      ]) {
        if (resource.program) gl.deleteProgram(resource.program);
      }
      for (const program of Object.values(displayMaterial.programs)) {
        if (program) gl.deleteProgram(program);
      }
      for (const shader of [
        baseVertexShader,
        copyShader,
        clearShader,
        splatShader,
        advectionShader,
        divergenceShader,
        curlShader,
        vorticityShader,
        pressureShader,
        gradientSubtractShader
      ]) {
        if (shader) gl.deleteShader(shader);
      }
      gl.deleteBuffer(blitBuffer);
      gl.deleteBuffer(blitElementBuffer);
    };
  }, [SIM_RESOLUTION, DYE_RESOLUTION, PRESSURE_ITERATIONS, SHADING, contextGeneration]);

  useEffect(() => {
    if (AUTO_MOTION) startLoopRef.current?.();
  }, [AUTO_MOTION]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default Flash;
