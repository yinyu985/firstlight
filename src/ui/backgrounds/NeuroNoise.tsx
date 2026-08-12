import { type ReactElement } from "react";
import { NeuroNoise as PaperNeuroNoise } from "@paper-design/shaders-react";

type NeuroNoiseParameters = {
  colorFront?: string;
  colorMid?: string;
  colorBack?: string;
  brightness?: number;
  contrast?: number;
  scale?: number;
  rotation?: number;
};

export interface NeuroNoiseProps {
  className?: string;
  from?: string;
  to?: string;
  speed?: number;
  parameters?: NeuroNoiseParameters;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function NeuroNoise({
  className = "dynamic-background",
  from = "#f7f1e8",
  to = "#c8b8a5",
  speed = 10,
  parameters
}: NeuroNoiseProps): ReactElement {
  const globalSpeed = clamp(speed, 0, 4);
  const colorFront = parameters?.colorFront ?? from ?? "#f7f1e8";
  const colorMid = parameters?.colorMid ?? to ?? "#c8b8a5";
  const colorBack = parameters?.colorBack ?? "#12171d";

  const brightness = getNumber(parameters?.brightness, 0.05);
  const contrast = getNumber(parameters?.contrast, 0.3);
  const scale = clamp(getNumber(parameters?.scale, 1), 0.1, 4);
  const rotation = clamp(getNumber(parameters?.rotation, 0), -180, 180);

  return (
    <PaperNeuroNoise
      className={className}
      colorFront={colorFront}
      colorMid={colorMid}
      colorBack={colorBack}
      brightness={clamp(brightness, -1, 1)}
      contrast={clamp(contrast, -1, 1)}
      scale={scale}
      rotation={rotation}
      speed={globalSpeed}
      width="100%"
      height="100%"
      fit="cover"
    />
  );
}

export default NeuroNoise;
