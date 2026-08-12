import { type ReactElement, useCallback, useEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import { InertiaPlugin } from "gsap/InertiaPlugin";

const hasInertiaPlugin = Boolean(InertiaPlugin);
if (hasInertiaPlugin) {
  gsap.registerPlugin(InertiaPlugin);
}

export type DotGridParameters = {
  dotSize?: number;
  gap?: number;
  proximity?: number;
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  resistance?: number;
  returnDuration?: number;
};

interface Dot {
  cx: number;
  cy: number;
  xOffset: number;
  yOffset: number;
  _inertiaApplied: boolean;
}

export type DotGridRuntimeConfig = {
  proximity: number;
  shockRadius: number;
  shockStrength: number;
  resistance: number;
  returnDuration: number;
  speedTrigger: number;
  maxSpeed: number;
  speedScale: number;
};

function hexToRgb(hex: string) {
  const matched = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!matched) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(matched[1], 16),
    g: parseInt(matched[2], 16),
    b: parseInt(matched[3], 16)
  };
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseNumericValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export interface DotGridSettings extends DotGridRuntimeConfig {
  dotSize: number;
  gap: number;
}

export function resolveDotGridSettings(speed: number, parameters: DotGridParameters = {}): DotGridSettings {
  return {
    speedScale: clampValue(parseNumericValue(speed, 10) / 10, 0.5, 2.2),
    dotSize: clampValue(parseNumericValue(parameters.dotSize, 16), 2, 120),
    gap: clampValue(parseNumericValue(parameters.gap, 32), 2, 160),
    proximity: clampValue(parseNumericValue(parameters.proximity, 150), 20, 900),
    speedTrigger: clampValue(parseNumericValue(parameters.speedTrigger, 100), 20, 500),
    shockRadius: clampValue(parseNumericValue(parameters.shockRadius, 250), 30, 1200),
    shockStrength: clampValue(parseNumericValue(parameters.shockStrength, 5), 0.2, 10),
    maxSpeed: clampValue(parseNumericValue(parameters.maxSpeed, 5000), 300, 20000),
    resistance: clampValue(parseNumericValue(parameters.resistance, 750), 150, 4000),
    returnDuration: clampValue(parseNumericValue(parameters.returnDuration, 1.5), 0.1, 5)
  };
}

export function dotGridProximityMix(distance: number, proximity: number): number {
  return clampValue(1 - distance / Math.max(1, proximity), 0, 1);
}

export function dotGridShockImpulse(
  deltaX: number,
  deltaY: number,
  distance: number,
  settings: DotGridRuntimeConfig
): { x: number; y: number; resistance: number; returnDuration: number } | null {
  if (distance >= settings.shockRadius) return null;
  const falloff = 1 - distance / settings.shockRadius;
  return {
    x: deltaX * settings.shockStrength * settings.speedScale * falloff,
    y: deltaY * settings.shockStrength * settings.speedScale * falloff,
    resistance: settings.resistance,
    returnDuration: settings.returnDuration
  };
}

export interface DotGridProps {
  className?: string;
  from?: string;
  to?: string;
  speed?: number;
  parameters?: DotGridParameters;
}

export function DotGrid({
  className = "dynamic-background",
  from = "#102030",
  to = "#89f7ff",
  speed = 10,
  parameters
}: DotGridProps): ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const pointerRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0
  });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const isDocumentHidden = useRef(false);
  const requestDrawRef = useRef<(() => void) | null>(null);
  const runtimeRef = useRef<DotGridRuntimeConfig>({
    proximity: 150,
    shockRadius: 250,
    shockStrength: 5,
    resistance: 750,
    returnDuration: 1.5,
    speedTrigger: 100,
    maxSpeed: 5000,
    speedScale: 1
  });

  const buildImpulse = useCallback((pushX: number, pushY: number, resistanceValue: number) => {
    if (hasInertiaPlugin) {
      return {
        inertia: {
          xOffset: pushX,
          yOffset: pushY,
          resistance: resistanceValue
        }
      };
    }
    return {
      xOffset: pushX,
      yOffset: pushY,
      duration: 0.35,
      ease: "power2.out"
    };
  }, []);

  const baseColor = from ?? "#102030";
  const activeColor = to ?? "#89f7ff";

  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor]);
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor]);

  const {
    speedScale,
    dotSize,
    gap,
    proximity,
    speedTrigger,
    shockRadius,
    shockStrength,
    maxSpeed,
    resistance,
    returnDuration
  } = resolveDotGridSettings(speed, parameters);

  const circlePath = useMemo(() => {
    if (typeof window === "undefined" || !window.Path2D) return null;
    const path = new Path2D();
    path.arc(0, 0, dotSize / 2, 0, Math.PI * 2);
    return path;
  }, [dotSize]);

  const buildGrid = useCallback(() => {
    const wrap = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

      const { width, height } = wrap.getBoundingClientRect();
    if (width <= 0 || height <= 0) {
      dotsRef.current = [];
      sizeRef.current = { width: 0, height: 0, dpr: 1 };
      return;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scaledWidth = Math.max(1, Math.floor(width * dpr));
    const scaledHeight = Math.max(1, Math.floor(height * dpr));
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (context) {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    sizeRef.current = { width, height, dpr };

    const cols = Math.floor((width + gap) / (dotSize + gap));
    const rows = Math.floor((height + gap) / (dotSize + gap));
    const cell = dotSize + gap;
    const gridWidth = cell * cols - gap;
    const gridHeight = cell * rows - gap;
    const startX = (width - gridWidth) / 2 + dotSize / 2;
    const startY = (height - gridHeight) / 2 + dotSize / 2;

    const dots: Dot[] = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        dots.push({
          cx: startX + x * cell,
          cy: startY + y * cell,
          xOffset: 0,
          yOffset: 0,
          _inertiaApplied: false
        });
      }
    }
    dotsRef.current = dots;
    if (!isDocumentHidden.current) {
      requestDrawRef.current?.();
    }
  }, [dotSize, gap]);

  useEffect(() => {
    runtimeRef.current = {
      proximity,
      shockRadius,
      shockStrength,
      resistance,
      returnDuration,
      speedTrigger,
      maxSpeed,
      speedScale
    };
    if (requestDrawRef.current) {
      requestDrawRef.current();
    }
  }, [proximity, shockRadius, shockStrength, resistance, returnDuration, speedTrigger, maxSpeed, speedScale]);

  useEffect(() => {
    if (!circlePath) return;

    let rafId = 0;
    let disposed = false;
    let frameQueued = false;
    isDocumentHidden.current = typeof document !== "undefined" ? document.hidden : false;
    const schedule = () => {
      if (disposed || isDocumentHidden.current || frameQueued) return;
      frameQueued = true;
      rafId = requestAnimationFrame(() => {
        frameQueued = false;
        draw();
      });
    };
    requestDrawRef.current = schedule;

    const onVisibility = () => {
      isDocumentHidden.current = document.hidden;
      if (!disposed && !document.hidden) {
        schedule();
      }
    };

    const draw = () => {
      if (disposed) return;

      if (isDocumentHidden.current) {
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        schedule();
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) {
        schedule();
        return;
      }

      const { width, height } = sizeRef.current;
      if (width <= 0 || height <= 0) {
        return;
      }
      context.clearRect(0, 0, width, height);
      const { x: px, y: py } = pointerRef.current;
      const currentProximity = runtimeRef.current.proximity;
      const proxSq = currentProximity * currentProximity;

      for (const dot of dotsRef.current) {
        const ox = dot.cx + dot.xOffset;
        const oy = dot.cy + dot.yOffset;
        const dx = dot.cx - px;
        const dy = dot.cy - py;
        const dsq = dx * dx + dy * dy;

        let fill = baseColor;
        if (dsq <= proxSq) {
          const dist = Math.sqrt(dsq);
          const t = dotGridProximityMix(dist, currentProximity);
          const r = Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t);
          const g = Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t);
          const b = Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t);
          fill = `rgb(${r},${g},${b})`;
        }

        context.save();
        context.translate(ox, oy);
        context.fillStyle = fill;
        context.fill(circlePath);
        context.restore();
      }

      schedule();
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule();

    return () => {
      disposed = true;
      requestDrawRef.current = null;
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [circlePath, baseRgb, activeRgb, baseColor]);

  useEffect(() => {
    buildGrid();
    let resizeObserver: ResizeObserver | null = null;
    const resizeWindow = window as Window;

    if (typeof ResizeObserver !== "undefined" && typeof resizeWindow !== "undefined") {
      resizeObserver = new ResizeObserver(buildGrid);
      wrapperRef.current && resizeObserver.observe(wrapperRef.current);
    } else {
      resizeWindow.addEventListener("resize", buildGrid);
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      else resizeWindow.removeEventListener("resize", buildGrid);
    };
  }, [buildGrid]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onMove = (event: PointerEvent) => {
      const settings = runtimeRef.current;
      const now = performance.now();
      const state = pointerRef.current;
      const delta = state.lastTime ? Math.max(4, now - state.lastTime) : 16;
      const dx = event.clientX - state.lastX;
      const dy = event.clientY - state.lastY;
      let vx = (dx / delta) * 1000;
      let vy = (dy / delta) * 1000;
      vx *= settings.speedScale;
      vy *= settings.speedScale;
      let currentSpeed = Math.hypot(vx, vy);

      if (currentSpeed > settings.maxSpeed) {
        const ratio = settings.maxSpeed / currentSpeed;
        vx *= ratio;
        vy *= ratio;
        currentSpeed = settings.maxSpeed;
      }

      state.lastTime = now;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      state.vx = vx;
      state.vy = vy;
      state.speed = currentSpeed;

      const rect = wrapper.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      state.x = event.clientX - rect.left;
      state.y = event.clientY - rect.top;

      const maxRange = Math.max(0, Math.min(2000, settings.proximity));
      const trigger = Math.max(1, settings.speedTrigger);

      for (const dot of dotsRef.current) {
        const distance = Math.hypot(dot.cx - state.x, dot.cy - state.y);
        if (currentSpeed > trigger && distance < maxRange && !dot._inertiaApplied) {
          dot._inertiaApplied = true;
          gsap.killTweensOf(dot);
          const pushX = dot.cx - state.x + state.vx * 0.005;
          const pushY = dot.cy - state.y + state.vy * 0.005;
          gsap.to(dot, {
            ...buildImpulse(pushX, pushY, settings.resistance),
            onComplete: () => {
              gsap.to(dot, {
                xOffset: 0,
                yOffset: 0,
                duration: runtimeRef.current.returnDuration,
                ease: "elastic.out(1,0.75)"
              });
              dot._inertiaApplied = false;
            }
          });
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const settings = runtimeRef.current;
      const rect = wrapper.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      for (const dot of dotsRef.current) {
        const distance = Math.hypot(dot.cx - clickX, dot.cy - clickY);
        const impulse = dotGridShockImpulse(dot.cx - clickX, dot.cy - clickY, distance, settings);
        if (impulse && !dot._inertiaApplied) {
          dot._inertiaApplied = true;
          gsap.killTweensOf(dot);
          gsap.to(dot, {
            ...buildImpulse(impulse.x, impulse.y, impulse.resistance),
            onComplete: () => {
              gsap.to(dot, {
                xOffset: 0,
                yOffset: 0,
                duration: impulse.returnDuration,
                ease: "elastic.out(1,0.75)"
              });
              dot._inertiaApplied = false;
            }
          });
        }
      }
    };

    let lastPointerMove = 0;
    const throttledMove = (event: Event) => {
      const now = performance.now();
      if (now - lastPointerMove < 50) return;
      lastPointerMove = now;
      onMove(event as PointerEvent);
    };
    window.addEventListener("pointermove", throttledMove as EventListener, { passive: true });
    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("pointermove", throttledMove as EventListener);
      window.removeEventListener("pointerdown", onPointerDown);
      gsap.killTweensOf(dotsRef.current);
    };
  }, [buildImpulse]);


  return (
    <section
      className={className}
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%"
      }}
    >
      <div
        ref={wrapperRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative"
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none"
          }}
        />
      </div>
    </section>
  );
}

export default DotGrid;
