import { useEffect, useRef, type ReactElement } from "react";
import { boundedCanvasSize } from "./canvasSizing";

// Adapted from React Bits Silk by David Haz.
// See THIRD_PARTY_NOTICES.md for the applicable license and restriction.

export interface SilkFlowParameters {
  scale?: number;
  noiseIntensity?: number;
  rotation?: number;
}

export interface SilkFlowSettings {
  scale: number;
  noiseIntensity: number;
  rotation: number;
  speed: number;
}

export interface SilkFlowProps {
  className?: string;
  from?: string;
  to?: string;
  speed?: number;
  parameters?: SilkFlowParameters;
}

interface SilkFlowRuntime extends SilkFlowSettings {
  color: [number, number, number];
}

interface Renderer {
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  position: number;
  program: WebGLProgram;
  uniforms: {
    color: WebGLUniformLocation | null;
    noiseIntensity: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
    scale: WebGLUniformLocation | null;
    speed: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
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

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;

const float e = 2.71828182845904523536;

float noise(vec2 textureCoordinate) {
  float base = e;
  vec2 randomPair = base * sin(base * textureCoordinate);
  return fract(randomPair.x * randomPair.y * (1.0 + textureCoordinate.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  mat2 rotation = mat2(cosine, -sine, sine, cosine);
  return rotation * uv;
}

void main() {
  float randomNoise = noise(gl_FragCoord.xy);
  vec2 uv = rotateUvs(vUv * uScale, uRotation);
  vec2 textureCoordinate = uv * uScale;
  float timeOffset = uSpeed * uTime;

  textureCoordinate.y += 0.03 * sin(8.0 * textureCoordinate.x - timeOffset);

  float pattern = 0.6 + 0.4 * sin(
    5.0 * (
      textureCoordinate.x + textureCoordinate.y
      + cos(3.0 * textureCoordinate.x + 5.0 * textureCoordinate.y)
      + 0.02 * timeOffset
    )
    + sin(20.0 * (textureCoordinate.x + textureCoordinate.y - 0.1 * timeOffset))
  );

  vec4 color = vec4(uColor, 1.0) * vec4(pattern) - randomNoise / 15.0 * uNoiseIntensity;
  color.a = 1.0;
  gl_FragColor = color;
}
`;

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function numericValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveSilkFlowSettings(speed = 9, parameters: SilkFlowParameters = {}): SilkFlowSettings {
  return {
    speed: clampValue(numericValue(speed, 9), 0, 20),
    scale: clampValue(numericValue(parameters.scale, 2), 0.1, 5),
    noiseIntensity: clampValue(numericValue(parameters.noiseIntensity, 3), 0, 5),
    rotation: clampValue(numericValue(parameters.rotation, 0), 0, 6.28)
  };
}

export function silkFlowColor(hex: string, fallback = "#48b676"): [number, number, number] {
  const valid = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  const resolved = /^#[0-9a-f]{6}$/i.test(valid) ? valid : "#48b676";
  return [
    Number.parseInt(resolved.slice(1, 3), 16) / 255,
    Number.parseInt(resolved.slice(3, 5), 16) / 255,
    Number.parseInt(resolved.slice(5, 7), 16) / 255
  ];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error("[SilkFlow] shader compilation failed:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
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
    console.error("[SilkFlow] shader link failed:", gl.getProgramInfoLog(program));
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
  gl.clearColor(0, 0, 0, 1);
  return {
    buffer,
    gl,
    position,
    program,
    uniforms: {
      color: gl.getUniformLocation(program, "uColor"),
      noiseIntensity: gl.getUniformLocation(program, "uNoiseIntensity"),
      rotation: gl.getUniformLocation(program, "uRotation"),
      scale: gl.getUniformLocation(program, "uScale"),
      speed: gl.getUniformLocation(program, "uSpeed"),
      time: gl.getUniformLocation(program, "uTime")
    }
  };
}

function destroyRenderer(renderer: Renderer | null): void {
  if (!renderer) return;
  renderer.gl.deleteBuffer(renderer.buffer);
  renderer.gl.deleteProgram(renderer.program);
}

export function SilkFlow({ className = "dynamic-background", from = "#48b676", speed = 9, parameters }: SilkFlowProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resolved = resolveSilkFlowSettings(speed, parameters);
  const runtimeRef = useRef<SilkFlowRuntime>({ ...resolved, color: silkFlowColor(from) });
  runtimeRef.current = { ...resolved, color: silkFlowColor(from) };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer = createRenderer(canvas);
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
      if (canvas.width !== bounded.width || canvas.height !== bounded.height) {
        canvas.width = bounded.width;
        canvas.height = bounded.height;
      }
      renderer.gl.viewport(0, 0, bounded.width, bounded.height);
    };

    const schedule = () => {
      if (!disposed && renderer && animationFrame === null && document.visibilityState !== "hidden") {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const draw = (timestamp: number) => {
      animationFrame = null;
      if (disposed || !renderer || document.visibilityState === "hidden") return;
      const delta = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.05);
      lastFrame = timestamp;
      elapsed += delta * 0.1;
      const settings = runtimeRef.current;
      const { gl, position, program, uniforms } = renderer;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform3f(uniforms.color, settings.color[0], settings.color[1], settings.color[2]);
      gl.uniform1f(uniforms.speed, settings.speed);
      gl.uniform1f(uniforms.scale, settings.scale);
      gl.uniform1f(uniforms.rotation, settings.rotation);
      gl.uniform1f(uniforms.noiseIntensity, settings.noiseIntensity);
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
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      destroyRenderer(renderer);
      renderer = null;
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default SilkFlow;
