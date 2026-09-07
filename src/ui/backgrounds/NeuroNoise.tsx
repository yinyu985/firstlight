import { useLayoutEffect, useRef, type ReactElement } from "react";
import { ShaderFitOptions, ShaderMount, getShaderColorFromString, neuroNoiseFragmentShader, type ShaderMountUniforms } from "@paper-design/shaders";
import { createFrameGate } from "./frameBudget";
import { NEURO_NOISE_DEFAULT_COLORS } from "../../shared/dynamicEffects";
import { boundedCanvasSize } from "./canvasSizing";

type NeuroNoiseParameters = {
  colorFront?: string;
  colorMid?: string;
  colorBack?: string;
  brightness?: number;
  scale?: number;
  rotation?: number;
};

export interface NeuroNoiseProps {
  className?: string;
  speed?: number;
  parameters?: NeuroNoiseParameters;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

interface NeuroRuntimeSettings {
  brightness: number;
  colorBack: string;
  colorFront: string;
  colorMid: string;
  globalSpeed: number;
  rotation: number;
  scale: number;
}

function buildNeuroUniforms(settings: NeuroRuntimeSettings): ShaderMountUniforms {
  return {
    u_colorFront: getShaderColorFromString(settings.colorFront),
    u_colorMid: getShaderColorFromString(settings.colorMid),
    u_colorBack: getShaderColorFromString(settings.colorBack),
    u_brightness: clamp(settings.brightness, -1, 1),
    u_contrast: 0,
    u_fit: ShaderFitOptions.cover,
    u_scale: settings.scale,
    u_rotation: settings.rotation,
    u_offsetX: 0,
    u_offsetY: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_worldWidth: 0,
    u_worldHeight: 0
  };
}

export function NeuroNoise({ className = "dynamic-background", speed = 10, parameters }: NeuroNoiseProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const shaderRef = useRef<ShaderMount | null>(null);
  const resumeRef = useRef<(() => void) | null>(null);
  const globalSpeed = clamp(speed, 0, 4);
  const colorFront = parameters?.colorFront ?? NEURO_NOISE_DEFAULT_COLORS.front;
  const colorMid = parameters?.colorMid ?? NEURO_NOISE_DEFAULT_COLORS.mid;
  const colorBack = parameters?.colorBack ?? NEURO_NOISE_DEFAULT_COLORS.back;

  const brightness = getNumber(parameters?.brightness, 0.05);
  const scale = clamp(getNumber(parameters?.scale, 1), 0.1, 4);
  const rotation = clamp(getNumber(parameters?.rotation, 0), -180, 180);
  const currentSettingsRef = useRef<NeuroRuntimeSettings>({ brightness, colorBack, colorFront, colorMid, globalSpeed, rotation, scale });
  currentSettingsRef.current = { brightness, colorBack, colorFront, colorMid, globalSpeed, rotation, scale };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const settings = currentSettingsRef.current;
    try {
      const shader = new ShaderMount(
        host,
        neuroNoiseFragmentShader,
        buildNeuroUniforms(settings),
        { alpha: false, antialias: false, depth: false, premultipliedAlpha: false },
        0,
        0,
        1,
        3_000_000
      );
      shaderRef.current = shader;

      // Paper's React wrapper waits until after the first browser paint. Size and
      // draw synchronously here so the first visible AppShell frame already has
      // a complete Neuro canvas.
      const bounds = host.getBoundingClientRect();
      const canvasSize = boundedCanvasSize(bounds.width || window.innerWidth, bounds.height || window.innerHeight);
      shader.canvasElement.width = canvasSize.width;
      shader.canvasElement.height = canvasSize.height;
      shader.setFrame(0);

      let raf: number | undefined;
      let previous: number | undefined;
      const canDraw = createFrameGate();
      const schedule = () => {
        if (raf === undefined && !document.hidden && currentSettingsRef.current.globalSpeed !== 0) raf = requestAnimationFrame(draw);
      };
      const draw = (timestamp: number) => {
        raf = undefined;
        if (document.hidden) return;
        if (canDraw(timestamp)) {
          const elapsed = previous === undefined ? 0 : Math.min(50, timestamp - previous);
          previous = timestamp;
          shader.setFrame(shader.getCurrentFrame() + elapsed * currentSettingsRef.current.globalSpeed);
        }
        schedule();
      };
      const visibility = () => {
        previous = undefined;
        if (document.hidden && raf !== undefined) {
          cancelAnimationFrame(raf);
          raf = undefined;
        } else schedule();
      };
      resumeRef.current = schedule;
      document.addEventListener("visibilitychange", visibility);
      schedule();

      return () => {
        if (raf !== undefined) cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", visibility);
        resumeRef.current = null;
        shaderRef.current = null;
        shader.dispose();
      };
    } catch (cause) {
      console.error("[NeuroNoise] shader initialization failed:", cause);
    }
  }, []);

  useLayoutEffect(() => {
    const shader = shaderRef.current;
    if (!shader) return;
    shader.setUniforms(buildNeuroUniforms(currentSettingsRef.current));
    resumeRef.current?.();
  }, [brightness, colorBack, colorFront, colorMid, globalSpeed, rotation, scale]);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}

export default NeuroNoise;
