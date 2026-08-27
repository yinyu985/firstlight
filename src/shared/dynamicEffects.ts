export type DynamicEffectParameterValue = string | number | boolean;
export type DynamicEffectParameters = Record<string, DynamicEffectParameterValue>;

export interface RangeParameterDefinition {
  kind: "range";
  key: string;
  label: string;
  hint?: string;
  hidden?: boolean;
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
  hint?: string;
  hidden?: boolean;
  defaultValue: string;
}

export interface ToggleParameterDefinition {
  kind: "toggle";
  key: string;
  label: string;
  hint?: string;
  hidden?: boolean;
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
  hint?: string;
  hidden?: boolean;
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
  hint?: string;
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
  "silk",
  "smoke",
  "cells",
  "flash",
  "dotGrid",
  "lightPillar",
  "galaxy",
  "snow",
  "neuroNoise"
] as const;

export type DynamicEffect = typeof DYNAMIC_EFFECTS[number];

const FLOW_SPEC: DynamicEffectDefinition = {
  id: "flow",
  label: "FLOW I",
  supportsAngle: true,
  speed: { min: 10, max: 20, step: 1, defaultValue: 10, integer: true, label: "流动速度", hint: "控制两种颜色流动混合的快慢" },
  parameters: [],
  implemented: true,
  defaultParameters: {}
};

const range = (key: string, label: string, min: number, max: number, step: number, defaultValue: number, integer = false): RangeParameterDefinition => ({
  kind: "range", key, label, min, max, step, defaultValue, integer
});
const hiddenRange = (key: string, label: string, min: number, max: number, step: number, defaultValue: number, integer = false): RangeParameterDefinition => ({
  ...range(key, label, min, max, step, defaultValue, integer),
  hidden: true
});
const color = (key: string, label: string, defaultValue: string): ColorParameterDefinition => ({ kind: "color", key, label, defaultValue });
const toggle = (key: string, label: string, defaultValue: boolean): ToggleParameterDefinition => ({ kind: "toggle", key, label, defaultValue });
const select = (key: string, label: string, defaultValue: string, options: readonly SelectParameterOption[]): SelectParameterDefinition => ({ kind: "select", key, label, defaultValue, options });
const withHint = <T extends DynamicEffectParameterDefinition>(definition: T, hint: string): T => ({ ...definition, hint });
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

const SILK_PARAMETERS = [
  withHint(range("scale", "纹理大小", 0.1, 5, 0.1, 2), "数值越大，丝绸褶皱越密、范围越小"),
  withHint(range("noiseIntensity", "颗粒强度", 0, 5, 0.1, 3), "控制丝绸表面的细小明暗颗粒"),
  withHint(range("rotation", "纹理旋转角度", 0, 6.28, 0.1, 0), "以弧度旋转整片丝绸褶皱的方向")
] as const;

export const SILK_DEFAULT_COLORS = {
  silk: "#48b676"
} as const;

const CELLS_PARAMETERS = [
  withHint(range("wallThickness", "边界粗细", 0.3, 2.5, 0.05, 1), "控制每个细胞形状之间的分界线宽度")
] as const;

const SMOKE_PARAMETERS = [
  withHint(range("smokeCount", "烟雾层数", 1, 6, 1, 4, true), "控制同时出现多少股烟雾"),
  withHint(range("density", "烟雾浓度", 0.35, 1.5, 0.05, 0.9), "数值越大，烟雾越厚、遮盖越明显"),
  withHint(range("turbulence", "翻滚程度", 0, 2, 0.05, 1), "控制烟雾弯曲和翻涌的幅度"),
  withHint(range("spread", "烟雾大小", 0.5, 2, 0.05, 1), "控制每股烟雾占据的范围")
] as const;

const CELLS_SPEC: DynamicEffectDefinition = {
  id: "cells",
  label: "CELLS",
  supportsAngle: true,
  speed: { min: 10, max: 20, step: 1, defaultValue: 10, integer: true, label: "变化速度", hint: "控制细胞纹理持续变形的快慢" },
  parameters: CELLS_PARAMETERS,
  implemented: true,
  defaultParameters: defaultsFor(CELLS_PARAMETERS)
};

const FLASH_PARAMETERS = [
  withHint(range("simResolution", "流动计算精细度", 32, 256, 32, 128, true), "数值越大，流体转弯和相互推动时越细腻，也会占用更多性能"),
  withHint(range("dyeResolution", "颜色边缘精细度", 512, 2048, 128, 1440, true), "控制彩色流体边缘的清晰程度，数值越大越锐利"),
  withHint(range("densityDissipation", "颜色消散速度", 0.5, 10, 0.5, 3.5), "数值越大，鼠标留下的彩色轨迹消失得越快"),
  withHint(range("velocityDissipation", "流动惯性消散", 0.5, 5, 0.5, 2.5), "数值越大，流体被推动后越快停下来"),
  withHint(range("pressure", "流体回弹力度", 0, 1, 0.1, 0.1), "控制流体挤压后恢复平衡时保留多少推动力"),
  withHint(range("curl", "旋涡强度", 0, 30, 1, 16, true), "控制轨迹卷成旋涡和翻滚的明显程度"),
  withHint(range("splatRadius", "笔触范围", 0.05, 1, 0.05, 0.65), "控制鼠标每次划过时带起的彩色流体有多宽"),
  withHint(range("splatForce", "推动力度", 1000, 20000, 500, 6000, true), "控制鼠标移动对流体施加的冲击有多强"),
  withHint(toggle("autoMotion", "自动游走", false), "鼠标闲置时自动模拟一条平滑轨迹，让流体持续出现在画面中")
] as const;

const DOT_GRID_PARAMETERS = [
  withHint(range("dotSize", "圆点大小", 2, 120, 1, 16, true), "控制每个圆点的直径"),
  withHint(range("gap", "圆点间距", 2, 160, 1, 32, true), "控制圆点之间留出的空隙"),
  withHint(range("proximity", "鼠标光圈大小", 20, 900, 1, 150, true), "控制鼠标靠近时被点亮的范围"),
  hiddenRange("speedTrigger", "触发速度", 20, 500, 1, 100, true),
  hiddenRange("maxSpeed", "最大移动速度", 300, 20000, 10, 5000, true),
  hiddenRange("shockRadius", "冲击范围", 30, 1200, 1, 250, true),
  hiddenRange("shockStrength", "冲击力度", 0.2, 10, 0.1, 5),
  hiddenRange("resistance", "移动阻力", 150, 4000, 10, 750, true),
  hiddenRange("returnDuration", "回弹时间", 0.1, 5, 0.05, 1.5)
] as const;

const LIGHT_PILLAR_PARAMETERS = [
  withHint(range("rotation", "光柱旋转角度", -180, 180, 1, 0, true), "控制整根光柱向左或向右倾斜"),
  withHint(range("pillarWidth", "光柱宽度", 0.5, 12, 0.1, 8), "控制光柱横向覆盖的范围"),
  withHint(range("pillarHeight", "光柱高度", 0.1, 2, 0.05, 0.4), "控制光柱纵向延伸的长度")
] as const;

export const LIGHT_PILLAR_DEFAULT_COLORS = {
  top: "#5227ff",
  bottom: "#ff9ffc"
} as const;

const GALAXY_PARAMETERS = [
  withHint(range("focalX", "中心左右位置", 0, 1, 0.01, 0.5), "移动星河汇聚中心：0 在最左，1 在最右"),
  withHint(range("focalY", "中心上下位置", 0, 1, 0.01, 0.5), "移动星河汇聚中心：0 在最下，1 在最上"),
  withHint(range("rotationX", "画面朝向 · 横向值", -1, 1, 0.01, 1), "和纵向值一起改变星河的倾斜与朝向"),
  withHint(range("rotationY", "画面朝向 · 纵向值", -1, 1, 0.01, 0), "和横向值一起改变星河的倾斜与朝向"),
  withHint(range("starSpeed", "星层推进速度", 0, 2, 0.05, 0.5), "控制远近星层穿过画面的速度"),
  withHint(range("density", "星星密度", 0.1, 3, 0.05, 1), "数值越大，画面里的星星越多"),
  withHint(range("hueShift", "星星色调", 0, 360, 1, 140, true), "沿色环整体改变星星的颜色"),
  withHint(toggle("disableAnimation", "暂停动画", false), "打开后冻结画面，保留当前效果"),
  withHint(toggle("mouseInteraction", "跟随鼠标", true), "允许鼠标位置影响星河"),
  withHint(range("glowIntensity", "发光强度", 0, 2, 0.05, 0.3), "控制星点和光芒有多亮"),
  withHint(range("saturation", "颜色鲜艳度", 0, 2, 0.05, 0), "0 接近白色，数值越大颜色越鲜艳"),
  withHint(toggle("mouseRepulsion", "鼠标推开星星", true), "打开后，鼠标附近的星河会向外躲开"),
  withHint(range("twinkleIntensity", "闪烁强度", 0, 1, 0.05, 0.3), "控制星星忽明忽暗的幅度"),
  withHint(range("rotationSpeed", "自动旋转速度", -1, 1, 0.01, 0.1), "正负数控制不同旋转方向，0 表示不旋转"),
  withHint(range("repulsionStrength", "鼠标推力", 0, 5, 0.1, 2), "鼠标推开星河时的力度"),
  withHint(range("autoCenterRepulsion", "中心向外推力", 0, 5, 0.1, 0), "从画面中心持续推开星河；大于 0 时中心推力优先，鼠标跟随和鼠标推开暂时不生效"),
  withHint(toggle("transparent", "透明背景", true), "打开后透出下面设置的背景颜色"),
] as const;

export const GALAXY_DEFAULT_COLORS = {
  from: "#000000",
  to: "#10162a"
} as const;

const SNOW_PARAMETERS = [
  withHint(range("flakeSize", "近处雪花大小", 0.001, 0.05, 0.002, 0.019), "控制靠近镜头时雪花本体的尺寸"),
  withHint(range("minFlakeSize", "最小显示尺寸", 0.5, 3, 0.25, 2.75), "保证远处雪花在屏幕上不会小于这个像素尺寸"),
  withHint(range("pixelResolution", "像素画精细度", 50, 500, 25, 500, true), "数值越大像素块越细，数值越小复古颗粒越明显"),
  withHint(range("depthFade", "远处可见度", 1, 20, 1, 10, true), "数值越大，远处雪花保持明亮的距离越长"),
  withHint(range("farPlane", "最远绘制距离", 5, 50, 5, 15, true), "控制视野深处最多绘制多远的雪花"),
  withHint(range("brightness", "雪花亮度", 0.2, 3, 0.1, 3), "控制所有雪花的整体亮度"),
  withHint(range("gamma", "暗部提亮程度", 0.1, 1, 0.05, 1), "1 保持原始明暗；数值越小，较暗的雪花越亮"),
  withHint(range("density", "雪花密度", 0.1, 1, 0.05, 0.5), "控制空间中出现雪花的概率"),
  withHint(select("variant", "雪花形状", "snowflake", [
    { value: "square", label: "方块" },
    { value: "round", label: "圆点" },
    { value: "snowflake", label: "雪花" }
  ]), "选择每一片雪使用方块、圆点或六角雪花造型"),
  withHint(range("direction", "风向角度", 0, 360, 5, 90, true), "控制雪花整体飘动的方向")
] as const;

export const SNOW_DEFAULT_COLORS = {
  snow: "#ffffff",
  background: "#000000"
} as const;

export const NEURO_NOISE_DEFAULT_COLORS = {
  front: "#ffffff",
  mid: "#47a6ff",
  back: "#000000"
} as const;

const NEURO_NOISE_PARAMETERS = [
  withHint(color("colorFront", "前景颜色", NEURO_NOISE_DEFAULT_COLORS.front), "控制最靠前、最亮的纹理颜色"),
  withHint(color("colorMid", "中层颜色", NEURO_NOISE_DEFAULT_COLORS.mid), "控制纹理中间过渡层的颜色"),
  withHint(color("colorBack", "底层颜色", NEURO_NOISE_DEFAULT_COLORS.back), "控制最深处的背景颜色"),
  withHint(range("brightness", "整体亮度", -1, 1, 0.01, 0.05), "向左压暗画面，向右提亮画面"),
  withHint(range("scale", "纹理大小", 0.1, 4, 0.05, 1), "数值越大，神经纹理显示得越细密"),
  withHint(range("rotation", "纹理旋转角度", -180, 180, 1, 0), "控制整片神经纹理的朝向")
] as const;

const FLASH_SPEC = effectSpec("flash", "FLASH", { min: 1, max: 50, step: 1, defaultValue: 25, integer: true, label: "换色速度", hint: "控制鼠标轨迹换成下一种彩虹颜色的快慢" }, FLASH_PARAMETERS);
const SILK_SPEC = effectSpec("silk", "FLOW II", { min: 0, max: 20, step: 0.1, defaultValue: 9, label: "流动速度", hint: "控制丝绸褶皱向前流动的快慢" }, SILK_PARAMETERS);
const DOT_GRID_SPEC = effectSpec("dotGrid", "DOT", { min: 5, max: 22, step: 0.05, defaultValue: 10, label: "位移强度", hint: "控制鼠标快速划过时圆点被甩开的幅度" }, DOT_GRID_PARAMETERS);
const LIGHT_PILLAR_SPEC = effectSpec("lightPillar", "PILLAR", { min: 0.05, max: 2, step: 0.05, defaultValue: 0.3, label: "流动速度", hint: "控制光线在光柱中流动的快慢" }, LIGHT_PILLAR_PARAMETERS);
const GALAXY_SPEC = effectSpec("galaxy", "GALAXY", { min: 0.1, max: 3, step: 0.05, defaultValue: 1, label: "整体动画速度", hint: "统一加快或减慢星河的推进、闪烁和漂移" }, GALAXY_PARAMETERS);
const SNOW_SPEC = effectSpec("snow", "SNOW", { min: 0.1, max: 5, step: 0.25, defaultValue: 1.35, label: "飘落速度", hint: "控制雪花穿过画面的整体速度" }, SNOW_PARAMETERS);
const NEURO_NOISE_SPEC = effectSpec("neuroNoise", "NEURO", { min: 0, max: 4, step: 0.01, defaultValue: 1, label: "流动速度", hint: "控制神经纹理持续变化的快慢；0 表示静止" }, NEURO_NOISE_PARAMETERS);
const SMOKE_SPEC = effectSpec("smoke", "SMOKE", { min: 10, max: 20, step: 1, defaultValue: 12, integer: true, label: "飘动速度", hint: "控制烟雾整体向上流动的快慢" }, SMOKE_PARAMETERS);

export const DYNAMIC_EFFECT_DEFINITIONS: readonly DynamicEffectDefinition[] = [
  FLOW_SPEC,
  SILK_SPEC,
  SMOKE_SPEC,
  CELLS_SPEC,
  FLASH_SPEC,
  DOT_GRID_SPEC,
  LIGHT_PILLAR_SPEC,
  GALAXY_SPEC,
  SNOW_SPEC,
  NEURO_NOISE_SPEC
];

const registry = Object.fromEntries(DYNAMIC_EFFECT_DEFINITIONS.map((definition) => [definition.id, definition])) as Record<DynamicEffect, DynamicEffectDefinition>;

export const FALLBACK_DYNAMIC_EFFECT: DynamicEffect = "flow";

export function isDynamicEffect(value: unknown): value is DynamicEffect {
  return typeof value === "string" && Object.hasOwn(registry, value);
}

export function normalizeDynamicEffect(value: unknown): DynamicEffect {
  return isDynamicEffect(value) ? value : FALLBACK_DYNAMIC_EFFECT;
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
  const parameters: DynamicEffectParameters = {};
  for (const parameter of definition.parameters) {
    const value = rawParameters?.[parameter.key];
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
