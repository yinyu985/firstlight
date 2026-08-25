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
  "cells",
  "liquidChrome",
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

const range = (key: string, label: string, min: number, max: number, step: number, defaultValue: number, integer = false): RangeParameterDefinition => ({
  kind: "range", key, label, min, max, step, defaultValue, integer
});
const color = (key: string, label: string, defaultValue: string): ColorParameterDefinition => ({ kind: "color", key, label, defaultValue });
const toggle = (key: string, label: string, defaultValue: boolean): ToggleParameterDefinition => ({ kind: "toggle", key, label, defaultValue });
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

const CELLS_PARAMETERS = [
  range("wallThickness", "Wall thickness", 0.3, 2.5, 0.05, 1)
] as const;

const CELLS_SPEC: DynamicEffectDefinition = {
  id: "cells",
  label: "CELLS",
  supportsAngle: true,
  speed: { min: 10, max: 20, step: 1, defaultValue: 10, integer: true, label: "speed" },
  parameters: CELLS_PARAMETERS,
  implemented: true,
  defaultParameters: defaultsFor(CELLS_PARAMETERS)
};

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

const LIQUID_CHROME_SPEC = effectSpec("liquidChrome", "CHROME", { min: 0.02, max: 2, step: 0.01, defaultValue: 0.2 }, LIQUID_CHROME_PARAMETERS);
const DOT_GRID_SPEC = effectSpec("dotGrid", "DOT", { min: 5, max: 22, step: 0.05, defaultValue: 10 }, DOT_GRID_PARAMETERS);
const NEURO_NOISE_SPEC = effectSpec("neuroNoise", "NEURO", { min: 0, max: 4, step: 0.01, defaultValue: 1 }, NEURO_NOISE_PARAMETERS);

export const DYNAMIC_EFFECT_DEFINITIONS: readonly DynamicEffectDefinition[] = [
  FLOW_SPEC,
  CELLS_SPEC,
  LIQUID_CHROME_SPEC,
  DOT_GRID_SPEC,
  NEURO_NOISE_SPEC
];

const registry = Object.fromEntries(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => [definition.id, definition])) as Record<DynamicEffect, DynamicEffectDefinition>;

const PARAMETER_ALIASES: Partial<Record<DynamicEffect, Partial<Record<string, string>>>> = {
  liquidChrome: {
    interactive: "mouseInteraction"
  }
};

const LEGACY_DYNAMIC_ALIASES: Record<string, DynamicEffect> = {
  mesh: "cells",
  particles: "flow",
  grid: "flow",
  dither: "flow",
  rings: "flow",
  ferrofluid: "flow"
};

export const FALLBACK_DYNAMIC_EFFECT: DynamicEffect = "flow";

export function isDynamicEffect(value: unknown): value is DynamicEffect {
  return typeof value === "string" && Object.hasOwn(registry, value);
}

export function isDynamicEffectInput(value: unknown): value is DynamicEffect | keyof typeof LEGACY_DYNAMIC_ALIASES {
  return typeof value === "string" && (
    Object.hasOwn(registry, value) || Object.hasOwn(LEGACY_DYNAMIC_ALIASES, value)
  );
}

export function normalizeDynamicEffect(value: unknown): DynamicEffect {
  if (typeof value === "string") {
    if (Object.hasOwn(LEGACY_DYNAMIC_ALIASES, value)) return LEGACY_DYNAMIC_ALIASES[value];
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
