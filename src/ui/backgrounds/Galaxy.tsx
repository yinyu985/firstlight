import { useEffect, useRef, type ReactElement } from "react";
import { boundedCanvasSize } from "./canvasSizing";
import { bindWindowPointer } from "./pointerTracking";

// Adapted from React Bits Galaxy by David Haz.
// See THIRD_PARTY_NOTICES.md for the applicable license and restriction.

export interface GalaxyParameters {
  focalX?: number;
  focalY?: number;
  rotationX?: number;
  rotationY?: number;
  starSpeed?: number;
  density?: number;
  hueShift?: number;
  disableAnimation?: boolean;
  mouseInteraction?: boolean;
  glowIntensity?: number;
  saturation?: number;
  mouseRepulsion?: boolean;
  twinkleIntensity?: number;
  rotationSpeed?: number;
  repulsionStrength?: number;
  autoCenterRepulsion?: number;
  transparent?: boolean;
}

export interface GalaxySettings {
  focalX: number;
  focalY: number;
  rotationX: number;
  rotationY: number;
  starSpeed: number;
  density: number;
  hueShift: number;
  disableAnimation: boolean;
  mouseInteraction: boolean;
  glowIntensity: number;
  saturation: number;
  mouseRepulsion: boolean;
  twinkleIntensity: number;
  rotationSpeed: number;
  repulsionStrength: number;
  autoCenterRepulsion: number;
  transparent: boolean;
}

export interface GalaxyProps {
  className?: string;
  from?: string;
  to?: string;
  speed?: number;
  parameters?: GalaxyParameters;
}

interface GalaxyRuntime extends GalaxySettings {
  speed: number;
}

interface Renderer {
  buffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  position: number;
  program: WebGLProgram;
  uniforms: {
    autoCenterRepulsion: WebGLUniformLocation | null;
    density: WebGLUniformLocation | null;
    focal: WebGLUniformLocation | null;
    glowIntensity: WebGLUniformLocation | null;
    hueShift: WebGLUniformLocation | null;
    mouse: WebGLUniformLocation | null;
    mouseActiveFactor: WebGLUniformLocation | null;
    mouseRepulsion: WebGLUniformLocation | null;
    repulsionStrength: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
    rotationSpeed: WebGLUniformLocation | null;
    saturation: WebGLUniformLocation | null;
    speed: WebGLUniformLocation | null;
    starSpeed: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    transparent: WebGLUniformLocation | null;
    twinkleIntensity: WebGLUniformLocation | null;
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

uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform bool uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uAutoCenterRepulsion;
uniform bool uTransparent;
varying vec2 vUv;

#define NUM_LAYER 4.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0

float Hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float tri(float value) {
  return abs(fract(value) * 2.0 - 1.0);
}

float tris(float value) {
  float wrapped = fract(value);
  return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * wrapped - 1.0));
}

float trisn(float value) {
  float wrapped = fract(value);
  return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * wrapped - 1.0))) - 1.0;
}

vec3 hsv2rgb(vec3 color) {
  vec4 constants = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 channel = abs(fract(color.xxx + constants.xyz) * 6.0 - constants.www);
  return color.z * mix(constants.xxx, clamp(channel - constants.xxx, 0.0, 1.0), color.y);
}

float Star(vec2 uv, float flare) {
  float distanceToStar = length(uv);
  float brightness = (0.05 * uGlowIntensity) / distanceToStar;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  brightness += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  brightness += rays * 0.3 * flare * uGlowIntensity;
  brightness *= smoothstep(1.0, 0.2, distanceToStar);
  return brightness;
}

vec3 StarLayer(vec2 uv) {
  vec3 layerColor = vec3(0.0);
  vec2 gridPosition = fract(uv) - 0.5;
  vec2 gridId = floor(uv);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 starId = gridId + offset;
      float seed = Hash21(starId);
      float size = fract(seed * 345.32);
      float gloss = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * gloss;

      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(starId + 1.0)) + STAR_COLOR_CUTOFF;
      float blue = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(starId + 3.0)) + STAR_COLOR_CUTOFF;
      float green = min(red, blue) * seed;
      vec3 baseColor = vec3(red, green, blue);
      float hue = atan(baseColor.g - baseColor.r, baseColor.b - baseColor.r) / (2.0 * 3.14159) + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float saturation = length(baseColor - vec3(dot(baseColor, vec3(0.299, 0.587, 0.114)))) * uSaturation;
      float brightness = max(max(baseColor.r, baseColor.g), baseColor.b);
      baseColor = hsv2rgb(vec3(hue, saturation, brightness));

      vec2 drift = vec2(
        tris(seed * 34.0 + uTime * uSpeed / 10.0),
        tris(seed * 38.0 + uTime * uSpeed / 30.0)
      ) - 0.5;
      float star = Star(gridPosition - offset - drift, flareSize);
      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
      star *= mix(1.0, twinkle, uTwinkleIntensity);
      layerColor += star * size * baseColor;
    }
  }
  return layerColor;
}

void main() {
  vec2 focalPixels = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPixels) / uResolution.y;
  vec2 normalizedMouse = uMouse - vec2(0.5);

  if (uAutoCenterRepulsion > 0.0) {
    float centerDistance = length(uv);
    vec2 repulsion = normalize(uv) * (uAutoCenterRepulsion / (centerDistance + 0.1));
    uv += repulsion * 0.05;
  } else if (uMouseRepulsion) {
    vec2 mouseUv = (uMouse * uResolution.xy - focalPixels) / uResolution.y;
    float mouseDistance = length(uv - mouseUv);
    vec2 repulsion = normalize(uv - mouseUv) * (uRepulsionStrength / (mouseDistance + 0.1));
    uv += repulsion * 0.05 * uMouseActiveFactor;
  } else {
    uv += normalizedMouse * 0.1 * uMouseActiveFactor;
  }

  float automaticRotation = uTime * uRotationSpeed;
  mat2 automaticRotationMatrix = mat2(
    cos(automaticRotation), -sin(automaticRotation),
    sin(automaticRotation), cos(automaticRotation)
  );
  uv = automaticRotationMatrix * uv;
  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;

  vec3 color = vec3(0.0);
  for (float layer = 0.0; layer < 1.0; layer += 1.0 / NUM_LAYER) {
    float depth = fract(layer + uStarSpeed * uSpeed);
    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    color += StarLayer(uv * scale + layer * 453.32) * fade;
  }

  if (uTransparent) {
    float alpha = min(smoothstep(0.0, 0.3, length(color)), 1.0);
    gl_FragColor = vec4(color, alpha);
  } else {
    gl_FragColor = vec4(color, 1.0);
  }
}
`;

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function numericValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function resolveGalaxySettings(parameters: GalaxyParameters = {}): GalaxySettings {
  return {
    focalX: clampValue(numericValue(parameters.focalX, 0.5), 0, 1),
    focalY: clampValue(numericValue(parameters.focalY, 0.5), 0, 1),
    rotationX: clampValue(numericValue(parameters.rotationX, 1), -1, 1),
    rotationY: clampValue(numericValue(parameters.rotationY, 0), -1, 1),
    starSpeed: clampValue(numericValue(parameters.starSpeed, 0.5), 0, 2),
    density: clampValue(numericValue(parameters.density, 1), 0.1, 3),
    hueShift: clampValue(numericValue(parameters.hueShift, 140), 0, 360),
    disableAnimation: booleanValue(parameters.disableAnimation, false),
    mouseInteraction: booleanValue(parameters.mouseInteraction, true),
    glowIntensity: clampValue(numericValue(parameters.glowIntensity, 0.3), 0, 2),
    saturation: clampValue(numericValue(parameters.saturation, 0), 0, 2),
    mouseRepulsion: booleanValue(parameters.mouseRepulsion, true),
    twinkleIntensity: clampValue(numericValue(parameters.twinkleIntensity, 0.3), 0, 1),
    rotationSpeed: clampValue(numericValue(parameters.rotationSpeed, 0.1), -1, 1),
    repulsionStrength: clampValue(numericValue(parameters.repulsionStrength, 2), 0, 5),
    autoCenterRepulsion: clampValue(numericValue(parameters.autoCenterRepulsion, 0), 0, 5),
    transparent: booleanValue(parameters.transparent, true)
  };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error("[Galaxy] shader compilation failed:", gl.getShaderInfoLog(shader));
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
    console.error("[Galaxy] shader link failed:", gl.getProgramInfoLog(program));
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
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  return {
    buffer,
    gl,
    position,
    program,
    uniforms: {
      autoCenterRepulsion: gl.getUniformLocation(program, "uAutoCenterRepulsion"),
      density: gl.getUniformLocation(program, "uDensity"),
      focal: gl.getUniformLocation(program, "uFocal"),
      glowIntensity: gl.getUniformLocation(program, "uGlowIntensity"),
      hueShift: gl.getUniformLocation(program, "uHueShift"),
      mouse: gl.getUniformLocation(program, "uMouse"),
      mouseActiveFactor: gl.getUniformLocation(program, "uMouseActiveFactor"),
      mouseRepulsion: gl.getUniformLocation(program, "uMouseRepulsion"),
      repulsionStrength: gl.getUniformLocation(program, "uRepulsionStrength"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      rotation: gl.getUniformLocation(program, "uRotation"),
      rotationSpeed: gl.getUniformLocation(program, "uRotationSpeed"),
      saturation: gl.getUniformLocation(program, "uSaturation"),
      speed: gl.getUniformLocation(program, "uSpeed"),
      starSpeed: gl.getUniformLocation(program, "uStarSpeed"),
      time: gl.getUniformLocation(program, "uTime"),
      transparent: gl.getUniformLocation(program, "uTransparent"),
      twinkleIntensity: gl.getUniformLocation(program, "uTwinkleIntensity")
    }
  };
}

function destroyRenderer(renderer: Renderer | null): void {
  if (!renderer) return;
  renderer.gl.deleteBuffer(renderer.buffer);
  renderer.gl.deleteProgram(renderer.program);
}

export function Galaxy({ className = "dynamic-background", speed = 1, parameters }: GalaxyProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ targetX: 0.5, targetY: 0.5, smoothX: 0.5, smoothY: 0.5, targetActive: 0, smoothActive: 0 });
  const runtimeRef = useRef<GalaxyRuntime>({
    ...resolveGalaxySettings(parameters),
    speed: clampValue(numericValue(speed, 1), 0.1, 3)
  });
  runtimeRef.current = {
    ...resolveGalaxySettings(parameters),
    speed: clampValue(numericValue(speed, 1), 0.1, 3)
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer = createRenderer(canvas);
    let animationFrame: number | null = null;
    let elapsed = 0;
    let starPhase = 0;
    let lastFrame: number | null = null;
    let disposed = false;

    const resize = () => {
      if (disposed || !renderer) return;
      const bounds = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, bounds.width || canvas.clientWidth || window.innerWidth);
      const cssHeight = Math.max(1, bounds.height || canvas.clientHeight || window.innerHeight);
      const bounded = boundedCanvasSize(cssWidth, cssHeight);
      const dpr = Math.min(1, bounded.dpr);
      const width = Math.max(1, Math.floor(cssWidth * dpr));
      const height = Math.max(1, Math.floor(cssHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.gl.viewport(0, 0, width, height);
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
      const settings = runtimeRef.current;
      if (!settings.disableAnimation) {
        elapsed += delta;
        starPhase = elapsed * settings.starSpeed / 10;
      }
      const mouse = mouseRef.current;
      if (!settings.mouseInteraction) mouse.targetActive = 0;
      const smoothing = 1 - Math.exp(-delta * 3.1);
      mouse.smoothX += (mouse.targetX - mouse.smoothX) * smoothing;
      mouse.smoothY += (mouse.targetY - mouse.smoothY) * smoothing;
      mouse.smoothActive += (mouse.targetActive - mouse.smoothActive) * smoothing;

      const { gl, program, position, uniforms } = renderer;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform3f(uniforms.resolution, canvas.width, canvas.height, canvas.width / Math.max(1, canvas.height));
      gl.uniform2f(uniforms.focal, settings.focalX, settings.focalY);
      gl.uniform2f(uniforms.rotation, settings.rotationX, settings.rotationY);
      gl.uniform1f(uniforms.starSpeed, starPhase);
      gl.uniform1f(uniforms.density, settings.density);
      gl.uniform1f(uniforms.hueShift, settings.hueShift);
      gl.uniform1f(uniforms.speed, settings.speed);
      gl.uniform2f(uniforms.mouse, mouse.smoothX, mouse.smoothY);
      gl.uniform1f(uniforms.glowIntensity, settings.glowIntensity);
      gl.uniform1f(uniforms.saturation, settings.saturation);
      gl.uniform1i(uniforms.mouseRepulsion, settings.mouseRepulsion ? 1 : 0);
      gl.uniform1f(uniforms.twinkleIntensity, settings.twinkleIntensity);
      gl.uniform1f(uniforms.rotationSpeed, settings.rotationSpeed);
      gl.uniform1f(uniforms.repulsionStrength, settings.repulsionStrength);
      gl.uniform1f(uniforms.mouseActiveFactor, mouse.smoothActive);
      gl.uniform1f(uniforms.autoCenterRepulsion, settings.autoCenterRepulsion);
      gl.uniform1i(uniforms.transparent, settings.transparent ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      schedule();
    };

    const unbindPointer = bindWindowPointer(
      canvas,
      (pointer) => {
        if (!runtimeRef.current.mouseInteraction) return;
        const mouse = mouseRef.current;
        mouse.targetX = pointer.x;
        mouse.targetY = pointer.y;
      },
      (active) => {
        mouseRef.current.targetActive = runtimeRef.current.mouseInteraction && active ? 1 : 0;
      }
    );
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
      unbindPointer();
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      destroyRenderer(renderer);
      renderer = null;
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

export default Galaxy;
