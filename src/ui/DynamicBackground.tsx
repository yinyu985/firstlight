import { useEffect, useRef } from "react";
import type { Background } from "../shared/model";

type DynamicBackgroundSettings = Extract<Background, { type: "dynamic" }>;

interface Props {
  background: DynamicBackgroundSettings;
}

interface FrameConfig {
  angle: number;
  from: [number, number, number];
  speed: number;
  to: [number, number, number];
}

interface Renderer {
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  position: number;
  program: WebGLProgram;
  uniforms: {
    angle: WebGLUniformLocation | null;
    from: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    seed: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    to: WebGLUniformLocation | null;
  };
}

const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform vec2 u_seed;
uniform float u_time;
uniform float u_angle;
uniform vec3 u_from;
uniform vec3 u_to;

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
  float amplitude = 0.52;
  mat2 turn = mat2(0.80, 0.60, -0.60, 0.80);
  for (int octave = 0; octave < 4; octave += 1) {
    value += amplitude * noise(point);
    point = turn * point * 2.03 + vec2(17.17, 9.23);
    amplitude *= 0.50;
  }
  return value / 0.975;
}

vec3 oklabToSrgb(vec3 color) {
  float l = color.x + 0.3963377774 * color.y + 0.2158037573 * color.z;
  float m = color.x - 0.1055613458 * color.y - 0.0638541728 * color.z;
  float s = color.x - 0.0894841775 * color.y - 1.2914855480 * color.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  vec3 linearColor = vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
  vec3 low = linearColor * 12.92;
  vec3 high = 1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return clamp(mix(low, high, step(vec3(0.0031308), linearColor)), 0.0, 1.0);
}

void main() {
  float shortSide = max(1.0, min(u_resolution.x, u_resolution.y));
  vec2 point = (2.0 * gl_FragCoord.xy - u_resolution) / shortSide;
  float cosine = cos(u_angle);
  float sine = sin(u_angle);
  point = mat2(cosine, -sine, sine, cosine) * point;
  point *= vec2(0.72, 0.92);

  vec2 seedA = u_seed * 0.071;
  vec2 seedB = u_seed.yx * 0.093 + vec2(5.2, 1.3);
  vec2 domain = vec2(
    fbm(point * 0.72 + seedA + vec2(u_time * 0.12, u_time * 0.08)),
    fbm(point * 0.72 + seedB + vec2(-u_time * 0.09, u_time * 0.13))
  );

  vec2 warp = domain - 0.5;
  vec2 flowingPoint = point + 1.75 * warp;
  float broad = fbm(flowingPoint * 1.04 + seedB * 0.47 + vec2(u_time * 0.18, -u_time * 0.13));
  float current = fbm((point - 1.15 * warp.yx) * 0.58 + seedA * 0.63 + vec2(-u_time * 0.10, u_time * 0.15));
  float detail = noise(flowingPoint * 1.85 + seedA + vec2(u_time * 0.07, u_time * 0.11));

  float field = broad * 0.68 + current * 0.27 + detail * 0.05;
  float separated = clamp((field - 0.5) * 3.15 + 0.5, 0.0, 1.0);
  float blend = separated * separated * (3.0 - 2.0 * separated);
  vec3 color = oklabToSrgb(mix(u_from, u_to, blend));
  gl_FragColor = vec4(color, 1.0);
}
`;

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function hexToOklab(hex: string): [number, number, number] {
  const red = srgbToLinear(Number.parseInt(hex.slice(1, 3), 16));
  const green = srgbToLinear(Number.parseInt(hex.slice(3, 5), 16));
  const blue = srgbToLinear(Number.parseInt(hex.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

export function dynamicTimeScale(speed: number): number {
  const normalized = Math.max(0, Math.min(1, (speed - 10) / 10));
  return 0.54 + 1.67 * normalized ** 1.6;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
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
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return {
    buffer,
    gl,
    position: gl.getAttribLocation(program, "a_position"),
    program,
    uniforms: {
      angle: gl.getUniformLocation(program, "u_angle"),
      from: gl.getUniformLocation(program, "u_from"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      seed: gl.getUniformLocation(program, "u_seed"),
      time: gl.getUniformLocation(program, "u_time"),
      to: gl.getUniformLocation(program, "u_to")
    }
  };
}

function createSeed(): [number, number] {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return [values[0] / 0xffffffff * 97, values[1] / 0xffffffff * 97];
}

export function DynamicBackground({ background }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seedRef = useRef<[number, number] | null>(null);
  if (!seedRef.current) seedRef.current = createSeed();
  const frameConfigRef = useRef<FrameConfig>({
    angle: background.angle,
    from: hexToOklab(background.from),
    speed: background.speed,
    to: hexToOklab(background.to)
  });
  frameConfigRef.current = {
    angle: background.angle,
    from: hexToOklab(background.from),
    speed: background.speed,
    to: hexToOklab(background.to)
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: Renderer | null = createRenderer(canvas);
    let animationFrame: number | null = null;
    let elapsed = 0;
    let lastFrame: number | null = null;

    const resize = () => {
      if (!renderer) return;
      const cssWidth = Math.max(1, canvas.clientWidth || window.innerWidth);
      const cssHeight = Math.max(1, canvas.clientHeight || window.innerHeight);
      const pixelRatio = Math.min(1, Math.max(0.72, (window.devicePixelRatio || 1) * 0.72));
      const width = Math.round(cssWidth * pixelRatio);
      const height = Math.round(cssHeight * pixelRatio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.gl.viewport(0, 0, width, height);
    };

    const schedule = () => {
      if (animationFrame === null && document.visibilityState !== "hidden") {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const draw = (timestamp: number) => {
      animationFrame = null;
      if (!renderer || document.visibilityState === "hidden") return;
      if (lastFrame !== null && timestamp - lastFrame < 1000 / 45) {
        schedule();
        return;
      }
      const delta = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.05);
      lastFrame = timestamp;
      elapsed += delta * dynamicTimeScale(frameConfigRef.current.speed);
      resize();

      const { gl, program, position, uniforms } = renderer;
      const config = frameConfigRef.current;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform2f(uniforms.seed, seedRef.current![0], seedRef.current![1]);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform1f(uniforms.angle, config.angle * Math.PI / 180);
      gl.uniform3f(uniforms.from, config.from[0], config.from[1], config.from[2]);
      gl.uniform3f(uniforms.to, config.to[0], config.to[1], config.to[2]);
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
      renderer = null;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    };
    const handleContextRestored = () => {
      renderer = createRenderer(canvas);
      lastFrame = null;
      schedule();
    };

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    resize();
    schedule();
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      if (renderer) {
        renderer.gl.deleteBuffer(renderer.buffer);
        renderer.gl.deleteProgram(renderer.program);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="dynamic-background" aria-hidden="true" />;
}
