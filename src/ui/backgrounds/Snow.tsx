import { createFrameGate } from "./frameBudget";
import { useEffect, useRef, type ReactElement } from "react";

// Adapted from React Bits PixelSnow by David Haz.
// See THIRD_PARTY_NOTICES.md for the applicable license and restriction.

export type SnowVariant = "square" | "round" | "snowflake";

export interface SnowParameters {
  flakeSize?: number;
  minFlakeSize?: number;
  pixelResolution?: number;
  depthFade?: number;
  farPlane?: number;
  brightness?: number;
  gamma?: number;
  density?: number;
  variant?: SnowVariant;
  direction?: number;
}

export interface SnowSettings {
  flakeSize: number;
  minFlakeSize: number;
  pixelResolution: number;
  speed: number;
  depthFade: number;
  farPlane: number;
  brightness: number;
  gamma: number;
  density: number;
  variant: SnowVariant;
  direction: number;
}

export interface SnowProps {
  className?: string;
  from?: string;
  to?: string;
  speed?: number;
  parameters?: SnowParameters;
}

interface SnowRuntime extends SnowSettings {
  color: [number, number, number];
}

interface Renderer {
  buffer: WebGLBuffer;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uniforms: {
    brightness: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    density: WebGLUniformLocation | null;
    depthFade: WebGLUniformLocation | null;
    direction: WebGLUniformLocation | null;
    farPlane: WebGLUniformLocation | null;
    flakeSize: WebGLUniformLocation | null;
    gamma: WebGLUniformLocation | null;
    minFlakeSize: WebGLUniformLocation | null;
    pixelResolution: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    speed: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    variant: WebGLUniformLocation | null;
  };
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform float uTime;
uniform vec2 uResolution;
uniform float uFlakeSize;
uniform float uMinFlakeSize;
uniform float uPixelResolution;
uniform float uSpeed;
uniform float uDepthFade;
uniform float uFarPlane;
uniform vec3 uColor;
uniform float uBrightness;
uniform float uGamma;
uniform float uDensity;
uniform float uVariant;
uniform float uDirection;
out vec4 outColor;

#define PI_OVER_6 0.5235988
#define PI_OVER_3 1.0471976
#define M1 1597334677U
#define M2 3812015801U
#define M3 3299493293U
#define F0 2.3283064e-10
#define hash(n) (n * (n ^ (n >> 15)))
#define coord3(p) (uvec3(p).x * M1 ^ uvec3(p).y * M2 ^ uvec3(p).z * M3)

const vec3 camK = vec3(0.57735027, 0.57735027, 0.57735027);
const vec3 camI = vec3(0.70710678, 0.0, -0.70710678);
const vec3 camJ = vec3(-0.40824829, 0.81649658, -0.40824829);
const vec2 branchDirection = vec2(0.574, 0.819);

vec3 hash3(uint n) {
  uvec3 hashed = hash(n) * uvec3(1U, 511U, 262143U);
  return vec3(hashed) * F0;
}

float snowflakeDist(vec2 point) {
  float radius = length(point);
  float angle = atan(point.y, point.x);
  angle = abs(mod(angle + PI_OVER_6, PI_OVER_3) - PI_OVER_6);
  vec2 wedge = radius * vec2(cos(angle), sin(angle));
  float mainBranch = max(abs(wedge.y), max(-wedge.x, wedge.x - 1.0));
  float branchOnePosition = clamp(dot(wedge - vec2(0.4, 0.0), branchDirection), 0.0, 0.4);
  float branchOne = length(wedge - vec2(0.4, 0.0) - branchOnePosition * branchDirection);
  float branchTwoPosition = clamp(dot(wedge - vec2(0.7, 0.0), branchDirection), 0.0, 0.25);
  float branchTwo = length(wedge - vec2(0.7, 0.0) - branchTwoPosition * branchDirection);
  return min(mainBranch, min(branchOne, branchTwo)) * 10.0;
}

void main() {
  float inversePixelResolution = 1.0 / uPixelResolution;
  float pixelSize = max(1.0, floor(0.5 + uResolution.x * inversePixelResolution));
  float inversePixelSize = 1.0 / pixelSize;
  vec2 fragmentCoordinate = floor(gl_FragCoord.xy * inversePixelSize);
  vec2 resolution = uResolution * inversePixelSize;
  float inverseResolutionX = 1.0 / resolution.x;

  vec3 ray = normalize(vec3((fragmentCoordinate - resolution * 0.5) * inverseResolutionX, 1.0));
  ray = ray.x * camI + ray.y * camJ + ray.z * camK;

  float timeSpeed = uTime * uSpeed;
  float windX = cos(uDirection) * 0.4;
  float windY = sin(uDirection) * 0.4;
  vec3 cameraPosition = (windX * camI + windY * camJ + 0.1 * camK) * timeSpeed;
  vec3 position = cameraPosition;

  vec3 absoluteRay = max(abs(ray), vec3(0.001));
  vec3 strides = 1.0 / absoluteRay;
  vec3 raySign = step(ray, vec3(0.0));
  vec3 phase = fract(position) * strides;
  phase = mix(strides - phase, phase, raySign);

  float rayDotCamera = dot(ray, camK);
  float inverseRayDotCamera = 1.0 / rayDotCamera;
  float inverseDepthFade = 1.0 / uDepthFade;
  float halfInverseResolutionX = 0.5 * inverseResolutionX;
  vec3 timeAnimation = timeSpeed * 0.1 * vec3(7.0, 8.0, 5.0);

  float distanceTravelled = 0.0;
  for (int index = 0; index < 128; index++) {
    if (distanceTravelled >= uFarPlane) break;

    vec3 flooredPosition = floor(position);
    uint cellCoordinate = coord3(flooredPosition);
    float cellHash = hash3(cellCoordinate).x;

    if (cellHash < uDensity) {
      vec3 hashedPosition = hash3(cellCoordinate);
      vec3 sineArgumentOne = flooredPosition.yzx * 0.073;
      vec3 sineArgumentTwo = flooredPosition.zxy * 0.27;
      vec3 flakePosition = 0.5 - 0.5 * cos(
        4.0 * sin(sineArgumentOne) + 4.0 * sin(sineArgumentTwo) + 2.0 * hashedPosition + timeAnimation
      );
      flakePosition = flakePosition * 0.8 + 0.1 + flooredPosition;

      float toIntersection = dot(flakePosition - position, camK) * inverseRayDotCamera;
      if (toIntersection > 0.0) {
        vec3 testPosition = position + ray * toIntersection - flakePosition;
        float testX = dot(testPosition, camI);
        float testY = dot(testPosition, camJ);
        vec2 testUv = abs(vec2(testX, testY));
        float depth = dot(flakePosition - cameraPosition, camK);
        float flakeSize = max(uFlakeSize, uMinFlakeSize * depth * halfInverseResolutionX);

        float distanceToFlake;
        if (uVariant < 0.5) {
          distanceToFlake = max(testUv.x, testUv.y);
        } else if (uVariant < 1.5) {
          distanceToFlake = length(testUv);
        } else {
          float inverseFlakeSize = 1.0 / flakeSize;
          distanceToFlake = snowflakeDist(vec2(testX, testY) * inverseFlakeSize) * flakeSize;
        }

        if (distanceToFlake < flakeSize) {
          float flakeSizeRatio = uFlakeSize / flakeSize;
          float intensity = exp2(-(distanceTravelled + toIntersection) * inverseDepthFade)
            * min(1.0, flakeSizeRatio * flakeSizeRatio)
            * uBrightness;
          outColor = vec4(uColor * pow(vec3(intensity), vec3(uGamma)), 1.0);
          return;
        }
      }
    }

    float nextStep = min(min(phase.x, phase.y), phase.z);
    vec3 selectedAxis = step(phase, vec3(nextStep));
    phase = phase - nextStep + strides * selectedAxis;
    distanceTravelled += nextStep;
    position = mix(position + ray * nextStep, floor(position + ray * nextStep + 0.5), selectedAxis);
  }

  outColor = vec4(0.0);
}
`;

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function numericValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function variantValue(value: unknown): SnowVariant {
  return value === "square" || value === "round" || value === "snowflake" ? value : "snowflake";
}

function variantUniform(value: SnowVariant): number {
  return value === "round" ? 1 : value === "snowflake" ? 2 : 0;
}

export function resolveSnowSettings(speed = 1.35, parameters: SnowParameters = {}): SnowSettings {
  return {
    flakeSize: clampValue(numericValue(parameters.flakeSize, 0.019), 0.001, 0.05),
    minFlakeSize: clampValue(numericValue(parameters.minFlakeSize, 2.75), 0.5, 3),
    pixelResolution: Math.round(clampValue(numericValue(parameters.pixelResolution, 500), 50, 2000)),
    speed: clampValue(numericValue(speed, 1.35), 0.1, 5),
    depthFade: Math.round(clampValue(numericValue(parameters.depthFade, 10), 1, 20)),
    farPlane: Math.round(clampValue(numericValue(parameters.farPlane, 15), 5, 50)),
    brightness: clampValue(numericValue(parameters.brightness, 3), 0.2, 3),
    gamma: clampValue(numericValue(parameters.gamma, 1), 0.1, 1),
    density: clampValue(numericValue(parameters.density, 0.5), 0.1, 1),
    variant: variantValue(parameters.variant),
    direction: Math.round(clampValue(numericValue(parameters.direction, 90), 0, 360))
  };
}

export function snowColor(hex: string, fallback = "#ffffff"): [number, number, number] {
  const valid = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  const resolved = /^#[0-9a-f]{6}$/i.test(valid) ? valid : "#ffffff";
  return [Number.parseInt(resolved.slice(1, 3), 16) / 255, Number.parseInt(resolved.slice(3, 5), 16) / 255, Number.parseInt(resolved.slice(5, 7), 16) / 255];
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error("[Snow] shader compilation failed:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false
  });
  if (!gl) return null;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
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
    console.error("[Snow] shader link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const position = gl.getAttribLocation(program, "a_position");
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  if (position < 0 || !buffer || !vao) {
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    return null;
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.clearColor(0, 0, 0, 0);

  return {
    buffer,
    gl,
    program,
    vao,
    uniforms: {
      brightness: gl.getUniformLocation(program, "uBrightness"),
      color: gl.getUniformLocation(program, "uColor"),
      density: gl.getUniformLocation(program, "uDensity"),
      depthFade: gl.getUniformLocation(program, "uDepthFade"),
      direction: gl.getUniformLocation(program, "uDirection"),
      farPlane: gl.getUniformLocation(program, "uFarPlane"),
      flakeSize: gl.getUniformLocation(program, "uFlakeSize"),
      gamma: gl.getUniformLocation(program, "uGamma"),
      minFlakeSize: gl.getUniformLocation(program, "uMinFlakeSize"),
      pixelResolution: gl.getUniformLocation(program, "uPixelResolution"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      speed: gl.getUniformLocation(program, "uSpeed"),
      time: gl.getUniformLocation(program, "uTime"),
      variant: gl.getUniformLocation(program, "uVariant")
    }
  };
}

function destroyRenderer(renderer: Renderer | null): void {
  if (!renderer) return;
  renderer.gl.deleteBuffer(renderer.buffer);
  renderer.gl.deleteVertexArray(renderer.vao);
  renderer.gl.deleteProgram(renderer.program);
}

export function Snow({ className = "dynamic-background", from = "#ffffff", speed = 1.35, parameters }: SnowProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const resolved = resolveSnowSettings(speed, parameters);
  const runtimeRef = useRef<SnowRuntime>({ ...resolved, color: snowColor(from) });
  runtimeRef.current = { ...resolved, color: snowColor(from) };

  useEffect(() => {
    resizeRef.current?.();
  }, [resolved.pixelResolution]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer = createRenderer(canvas);
    let animationFrame: number | null = null;
    let elapsed = 0;
    let lastFrame: number | null = null;
    let disposed = false;
    const canDraw = createFrameGate();

    const resize = () => {
      if (disposed || !renderer) return;
      const bounds = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, bounds.width || canvas.clientWidth || window.innerWidth);
      const cssHeight = Math.max(1, bounds.height || canvas.clientHeight || window.innerHeight);
      const requestedResolution = runtimeRef.current.pixelResolution;
      const visiblePixelSize = Math.max(1, Math.floor(0.5 + cssWidth / requestedResolution));
      const width = Math.max(1, Math.ceil(cssWidth / visiblePixelSize));
      const height = Math.max(1, Math.ceil(cssHeight / visiblePixelSize));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.gl.viewport(0, 0, width, height);
    };
    resizeRef.current = resize;

    const schedule = () => {
      if (!disposed && renderer && animationFrame === null && document.visibilityState !== "hidden") {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const draw = (timestamp: number) => {
      animationFrame = null;
      if (disposed || !renderer || document.visibilityState === "hidden") return;
      if (!canDraw(timestamp)) {
        schedule();
        return;
      }
      const delta = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.05);
      lastFrame = timestamp;
      elapsed += delta;
      const settings = runtimeRef.current;
      const { gl, program, uniforms, vao } = renderer;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.flakeSize, settings.flakeSize);
      gl.uniform1f(uniforms.minFlakeSize, settings.minFlakeSize);
      gl.uniform1f(uniforms.pixelResolution, settings.pixelResolution);
      gl.uniform1f(uniforms.speed, settings.speed);
      gl.uniform1f(uniforms.depthFade, settings.depthFade);
      gl.uniform1f(uniforms.farPlane, settings.farPlane);
      gl.uniform3f(uniforms.color, settings.color[0], settings.color[1], settings.color[2]);
      gl.uniform1f(uniforms.brightness, settings.brightness);
      gl.uniform1f(uniforms.gamma, settings.gamma);
      gl.uniform1f(uniforms.density, settings.density);
      gl.uniform1f(uniforms.variant, variantUniform(settings.variant));
      gl.uniform1f(uniforms.direction, (settings.direction * Math.PI) / 180);
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
      renderer = createRenderer(canvas);
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
      resizeRef.current = null;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      destroyRenderer(renderer);
      renderer = null;
    };
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ imageRendering: "pixelated" }} aria-hidden="true" />;
}

export default Snow;
