export type DynamicEffectParameterValue = string | number | boolean;
export type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;

export interface RangeParameterDefinition {
  kind: "range";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  integer?: boolean;
}

export interface ColorParameterDefinition {
  kind: "color";
  key: string;
  label: string;
  defaultValue: string;
}

export interface ToggleParameterDefinition {
  kind: "toggle";
  key: string;
  label: string;
  defaultValue: boolean;
}

export interface SelectParameterOption {
  value: string;
  label: string;
}

export interface SelectParameterDefinition {
  kind: "select";
  key: string;
  label: string;
  defaultValue: string;
  options: readonly SelectParameterOption[];
}

export type DynamicEffectParameterDefinition =
  | RangeParameterDefinition
  | ColorParameterDefinition
  | ToggleParameterDefinition
  | SelectParameterDefinition;

export interface DynamicSpeedSpec {
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  integer?: boolean;
  label?: string;
}

export interface DynamicEffectDefinition {
  id: DynamicEffect;
  label: string;
  supportsAngle: boolean;
  speed: DynamicSpeedSpec;
  parameters: readonly DynamicEffectParameterDefinition[];
  implemented: boolean;
  defaultParameters: DynamicEffectParameters;
}

export const DYNAMIC_EFFECTS = [
  "flow",
  "aurora",
  "cells",
  "snow",
  "topography",
  "webThreads",
  "moltenMetal",
  "iridescence",
  "liquidChrome",
  "balatro",
  "dotGrid",
  "neuroNoise"
] as const;

export type DynamicEffect = typeof DYNAMIC_EFFECTS[number];

const FLOW_SPEC: DynamicEffectDefinition = {
  id: "flow",
  label: "FLOW",
  supportsAngle: true,
  speed: { min: 10, max: 20, step: 1, defaultValue: 10, integer: true, label: "speed" },
  parameters: [],
  implemented: true,
  defaultParameters: {}
};

const AURORA_SPEC: DynamicEffectDefinition = {
  id: "aurora",
  label: "AURORA",
  supportsAngle: true,
  speed: { min: 10, max: 20, step: 1, defaultValue: 10, integer: true, label: "speed" },
  parameters: [],
  implemented: true,
  defaultParameters: {}
};

const CELLS_SPEC: DynamicEffectDefinition = {
  id: "cells",
  label: "CELLS",
  supportsAngle: true,
  speed: { min: 10, max: 20, step: 1, defaultValue: 10, integer: true, label: "speed" },
  parameters: [],
  implemented: true,
  defaultParameters: {}
};

const SNOW_SPEC: DynamicEffectDefinition = {
  id: "snow",
  label: "SNOW",
  supportsAngle: false,
  speed: { min: 10, max: 20, step: 1, defaultValue: 10, integer: true, label: "speed" },
  parameters: [],
  implemented: true,
  defaultParameters: {}
};

const range = (key: string, label: string, min: number, max: number, step: number, defaultValue: number, integer = false): RangeParameterDefinition => ({
  kind: "range", key, label, min, max, step, defaultValue, integer
});
const color = (key: string, label: string, defaultValue: string): ColorParameterDefinition => ({ kind: "color", key, label, defaultValue });
const toggle = (key: string, label: string, defaultValue: boolean): ToggleParameterDefinition => ({ kind: "toggle", key, label, defaultValue });
const select = (key: string, label: string, defaultValue: string, values: readonly string[]): SelectParameterDefinition => ({
  kind: "select",
  key,
  label,
  defaultValue,
  options: values.map((value) => ({ value, label: value.toUpperCase() }))
});
const defaultsFor = (parameters: readonly DynamicEffectParameterDefinition[]): DynamicEffectParameters => Object.fromEntries(
  parameters.map((parameter) => [parameter.key, parameter.defaultValue])
) as DynamicEffectParameters;
const effectSpec = (
  id: DynamicEffect,
  label: string,
  speed: DynamicSpeedSpec,
  parameters: readonly DynamicEffectParameterDefinition[]
): DynamicEffectDefinition => ({
  id,
  label,
  supportsAngle: false,
  speed,
  parameters,
  implemented: true,
  defaultParameters: defaultsFor(parameters)
});

const TOPOGRAPHY_PARAMETERS = [
  color("color3", "Mid color", "#00d8ff"),
  range("morphAmount", "Morph amount", 0.5, 6, 0.1, 3),
  range("morphSpeed", "Morph speed", 0.01, 0.2, 0.01, 0.05),
  range("bands", "Contour bands", 1, 8, 1, 2, true),
  range("thickness", "Line thickness", 0.01, 0.25, 0.01, 0.01),
  range("scale", "Scale", 0.3, 3, 0.05, 1),
  range("pixelSize", "Pixel size", 1, 40, 1, 1, true),
  range("glow", "Glow", 0, 1.2, 0.05, 0.5),
  select("colorMode", "Color mode", "elevation", ["elevation", "uniform", "alternating"]),
  range("contrast", "Contrast", 1, 3, 0.05, 3),
  range("brightness", "Brightness", 0.4, 1.6, 0.05, 1),
  toggle("fillBands", "Fill bands", false),
  range("opacity", "Opacity", 0, 1, 0.05, 1),
  toggle("grain", "Grain", true),
  range("grainIntensity", "Grain intensity", 0, 0.3, 0.01, 0.05),
  toggle("mouseInteraction", "Mouse interaction", true),
  range("mouseStrength", "Mouse strength", 0, 1.5, 0.05, 0.4),
  range("mouseRadius", "Mouse radius", 0.05, 1, 0.01, 0.3)
] as const;

const WEB_THREADS_PARAMETERS = [
  color("color3", "Color 3", "#00d8ff"),
  range("threadCount", "Thread count", 1, 10, 1, 6, true),
  range("frequency", "Frequency", 1, 14, 0.1, 5),
  range("spread", "Spread", 0, 0.6, 0.01, 0.18),
  range("taper", "Taper", 0, 3, 0.05, 1),
  range("position", "Position", 0, 1, 0.01, 0.5),
  select("fanMode", "Fan mode", "center", ["center", "left", "right"]),
  range("glow", "Glow", 0, 0.06, 0.001, 0.02),
  range("falloff", "Falloff", 0.3, 1.2, 0.01, 0.6),
  range("thickness", "Thickness", 0.3, 3, 0.05, 1.1),
  range("brightness", "Brightness", 0, 2.5, 0.05, 0.6),
  range("opacity", "Opacity", 0, 1, 0.01, 1),
  toggle("mirror", "Mirror", true),
  toggle("shimmer", "Shimmer", false),
  toggle("grain", "Grain", true),
  range("grainIntensity", "Grain intensity", 0, 0.3, 0.01, 0.05),
  toggle("mouseInteraction", "Mouse interaction", true),
  range("mouseStrength", "Mouse strength", 0, 1, 0.05, 0.3)
] as const;

const MOLTEN_METAL_PARAMETERS = [
  color("color3", "Color 3", "#ffd6a3"),
  range("scale", "Scale", 0.5, 12, 0.1, 4),
  range("detail", "Detail", 1, 8, 1, 3, true),
  range("glow", "Glow", 0.1, 6, 0.1, 1.6),
  range("coreSize", "Core size", 0.001, 1, 0.001, 0.1),
  range("swirl", "Swirl", -3, 3, 0.05, 1),
  range("fold", "Fold", -3, 3, 0.01, -0.2),
  range("blackPoint", "Black point", 0, 1, 0.01, 0.05),
  range("brightness", "Brightness", 0.2, 4, 0.05, 1.3),
  select("colorMode", "Color mode", "molten", ["molten", "ember", "frost"]),
  toggle("grain", "Grain", true),
  range("grainIntensity", "Grain intensity", 0, 0.4, 0.01, 0.05),
  range("opacity", "Opacity", 0, 1, 0.01, 1),
  toggle("mouseInteraction", "Mouse interaction", true),
  range("mouseStrength", "Mouse strength", 0, 3, 0.05, 0.3)
] as const;

const IRIDESCENCE_PARAMETERS = [
  range("amplitude", "Amplitude", 0.02, 1.2, 0.01, 0.1),
  color("color3", "Color 3", "#ffffff"),
  range("brightness", "Brightness", 0, 2, 0.01, 1),
  range("contrast", "Contrast", 0, 3, 0.01, 1),
  range("lighting", "Lighting", 0, 1, 0.01, 0),
  toggle("mouseInteraction", "Mouse interaction", true),
  range("mouseStrength", "Mouse strength", 0, 3, 0.05, 1)
] as const;

const LIQUID_CHROME_PARAMETERS = [
  range("amplitude", "Amplitude", 0.02, 0.3, 0.01, 0.2),
  range("frequencyX", "X frequency", 0.5, 12, 0.1, 3),
  range("frequencyY", "Y frequency", 0.5, 12, 0.1, 2),
  color("color3", "Color 3", "#1a1a1a"),
  range("brightness", "Brightness", 0, 2, 0.01, 1),
  range("contrast", "Contrast", 0, 3, 0.01, 1),
  range("lighting", "Lighting", 0, 1, 0.01, 0),
  toggle("mouseInteraction", "Mouse interaction", true),
  range("mouseStrength", "Mouse strength", 0, 3, 0.05, 1)
] as const;

const BALATRO_PARAMETERS = [
  color("color3", "Color 3", "#162325"),
  range("spinRotation", "Spin rotation", -8, 8, 0.05, -2),
  range("contrast", "Contrast", 0.5, 6, 0.05, 3.5),
  range("lighting", "Lighting", 0.05, 1.5, 0.01, 0.4),
  range("spinAmount", "Distortion", 0, 1, 0.01, 0.25),
  range("pixelFilter", "Pixel filter", 120, 1500, 1, 745, true),
  range("spinEase", "Spin ease", 0, 3, 0.01, 1),
  toggle("isRotate", "Auto rotate", false),
  range("offsetX", "X offset", -1, 1, 0.01, 0),
  range("offsetY", "Y offset", -1, 1, 0.01, 0),
  toggle("mouseInteraction", "Mouse interaction", true),
  range("mouseStrength", "Mouse strength", 0, 3, 0.05, 1)
] as const;

const DOT_GRID_PARAMETERS = [
  range("dotSize", "Dot size", 2, 120, 1, 16, true),
  range("gap", "Gap", 2, 160, 1, 32, true),
  range("proximity", "Proximity", 20, 900, 1, 150, true),
  range("speedTrigger", "Speed trigger", 20, 500, 1, 100, true),
  range("maxSpeed", "Max speed", 300, 20000, 10, 5000, true),
  range("shockRadius", "Shock radius", 30, 1200, 1, 250, true),
  range("shockStrength", "Shock strength", 0.2, 10, 0.1, 5),
  range("resistance", "Resistance", 150, 4000, 10, 750, true),
  range("returnDuration", "Return duration", 0.1, 5, 0.05, 1.5)
] as const;

const NEURO_NOISE_PARAMETERS = [
  color("colorFront", "Front color", "#ffffff"),
  color("colorMid", "Mid color", "#47a6ff"),
  color("colorBack", "Back color", "#000000"),
  range("brightness", "Brightness", -1, 1, 0.01, 0.05),
  range("contrast", "Contrast", -1, 1, 0.01, 0.3),
  range("scale", "Scale", 0.1, 4, 0.05, 1),
  range("rotation", "Rotation", -180, 180, 1, 0)
] as const;

const TOPOGRAPHY_SPEC = effectSpec("topography", "TOPO", { min: 0, max: 2, step: 0.01, defaultValue: 0.35 }, TOPOGRAPHY_PARAMETERS);
const WEB_THREADS_SPEC = effectSpec("webThreads", "THREADS", { min: 0, max: 2, step: 0.01, defaultValue: 0.2 }, WEB_THREADS_PARAMETERS);
const MOLTEN_METAL_SPEC = effectSpec("moltenMetal", "MOLTEN", { min: 0.02, max: 2.5, step: 0.01, defaultValue: 0.35 }, MOLTEN_METAL_PARAMETERS);
const IRIDESCENCE_SPEC = effectSpec("iridescence", "IRIDESCENCE", { min: 0.05, max: 6, step: 0.01, defaultValue: 1 }, IRIDESCENCE_PARAMETERS);
const LIQUID_CHROME_SPEC = effectSpec("liquidChrome", "CHROME", { min: 0.02, max: 2, step: 0.01, defaultValue: 0.2 }, LIQUID_CHROME_PARAMETERS);
const BALATRO_SPEC = effectSpec("balatro", "BALATRO", { min: 0.1, max: 20, step: 0.05, defaultValue: 7 }, BALATRO_PARAMETERS);
const DOT_GRID_SPEC = effectSpec("dotGrid", "DOT GRID", { min: 5, max: 22, step: 0.05, defaultValue: 10 }, DOT_GRID_PARAMETERS);
const NEURO_NOISE_SPEC = effectSpec("neuroNoise", "NEURO", { min: 0, max: 4, step: 0.01, defaultValue: 1 }, NEURO_NOISE_PARAMETERS);

export const DYNAMIC_EFFECT_DEFINITIONS: readonly DynamicEffectDefinition[] = [
  FLOW_SPEC,
  AURORA_SPEC,
  CELLS_SPEC,
  SNOW_SPEC,
  TOPOGRAPHY_SPEC,
  WEB_THREADS_SPEC,
  MOLTEN_METAL_SPEC,
  IRIDESCENCE_SPEC,
  LIQUID_CHROME_SPEC,
  BALATRO_SPEC,
  DOT_GRID_SPEC,
  NEURO_NOISE_SPEC
];

const registry = Object.fromEntries(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => [definition.id, definition])) as Record<DynamicEffect, DynamicEffectDefinition>;

const PARAMETER_ALIASES: Partial<Record<DynamicEffect, Partial<Record<string, string>>>> = {
  iridescence: {
    scale: "amplitude"
  },
  liquidChrome: {
    interactive: "mouseInteraction"
  }
};

const LEGACY_DYNAMIC_ALIASES: Record<string, DynamicEffect> = {
  mesh: "cells",
  particles: "snow",
  grid: "flow",
  dither: "flow",
  rings: "flow",
  ferrofluid: "flow"
};

export const FALLBACK_DYNAMIC_EFFECT: DynamicEffect = "flow";

export function isDynamicEffect(value: unknown): value is DynamicEffect {
  return typeof value === "string" && value in registry;
}

export function isDynamicEffectInput(value: unknown): value is DynamicEffect | keyof typeof LEGACY_DYNAMIC_ALIASES {
  return typeof value === "string" && (value in registry || value in LEGACY_DYNAMIC_ALIASES);
}

export function normalizeDynamicEffect(value: unknown): DynamicEffect {
  if (typeof value === "string") {
    const mapped = LEGACY_DYNAMIC_ALIASES[value];
    if (mapped) return mapped;
    if (isDynamicEffect(value)) return value;
  }
  return FALLBACK_DYNAMIC_EFFECT;
}

export function getDynamicEffectDefinition(effect: DynamicEffect): DynamicEffectDefinition {
  return registry[effect];
}

export function implementedDynamicEffects(): readonly DynamicEffectDefinition[] {
  return DYNAMIC_EFFECT_DEFINITIONS.filter((definition) => definition.implemented);
}

export function isDynamicEffectImplemented(effect: DynamicEffect): boolean {
  return registry[effect].implemented;
}

export function defaultDynamicParameters(effect: DynamicEffect): DynamicEffectParameters {
  return { ...registry[effect].defaultParameters };
}

export function normalizeDynamicParameters(effect: DynamicEffect, raw: unknown): DynamicEffectParameters {
  const definition = getDynamicEffectDefinition(effect);
  const rawParameters = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined;
  const aliases = PARAMETER_ALIASES[effect] ?? {};

  const parameters: DynamicEffectParameters = {};
  for (const parameter of definition.parameters) {
    const aliasKey = Object.entries(aliases).find(([, canonical]) => canonical === parameter.key)?.[0];
    const canonicalValue = rawParameters?.[parameter.key];
    const aliasValue = aliasKey === undefined ? undefined : rawParameters?.[aliasKey];
    const value = aliasValue !== undefined && (canonicalValue === undefined || canonicalValue === parameter.defaultValue)
      ? aliasValue
      : canonicalValue;
    switch (parameter.kind) {
      case "range": {
        const candidate = typeof value === "number" && Number.isFinite(value) ? value : parameter.defaultValue;
        const normalized = parameter.integer ? Math.round(candidate) : candidate;
        parameters[parameter.key] = Math.max(parameter.min, Math.min(parameter.max, normalized));
        break;
      }
      case "color": {
        if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
          parameters[parameter.key] = value;
        } else {
          parameters[parameter.key] = parameter.defaultValue;
        }
        break;
      }
      case "toggle": {
        parameters[parameter.key] = typeof value === "boolean" ? value : parameter.defaultValue;
        break;
      }
      case "select": {
        const options = new Set(parameter.options.map((option) => option.value));
        parameters[parameter.key] = options.has(typeof value === "string" ? value : "") ? value as string : parameter.defaultValue;
        break;
      }
      default: {
        const exhaustive: never = parameter;
        throw new Error(`Unsupported parameter kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return parameters;
}

export function getDynamicEffectSpeed(effect: DynamicEffect): DynamicSpeedSpec {
  return registry[effect].speed;
}

export function normalizeDynamicSpeed(effect: DynamicEffect, speed: unknown): number {
  const spec = getDynamicEffectSpeed(effect);
  const base = typeof speed === "number" && Number.isFinite(speed) ? speed : spec.defaultValue;
  if (spec.integer) {
    return Math.max(spec.min, Math.min(spec.max, Math.round(base)));
  }
  return Math.max(spec.min, Math.min(spec.max, base));
}

export function isDynamicSpeedValid(effect: DynamicEffect, speed: unknown): speed is number {
  if (!Number.isFinite(speed as number)) return false;
  const spec = getDynamicEffectSpeed(effect);
  if (typeof speed !== "number") return false;
  if (spec.integer && !Number.isInteger(speed)) return false;
  return speed >= spec.min && speed <= spec.max;
}
