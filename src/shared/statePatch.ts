import type { AppState } from "./protocol";

// Chrome messages are JSON serialized: null explicitly clears optional fields.
export type StatePatch = { [K in keyof AppState]?: AppState[K] | null };

export function statePatch(previous: AppState | undefined, next: AppState): StatePatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as Array<keyof AppState>) {
    if (!previous || previous[key] !== next[key]) patch[key] = next[key] ?? null;
  }
  return patch as StatePatch;
}

export function applyStatePatch(current: AppState, patch: StatePatch): AppState {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) Object.assign(next, { [key]: value ?? undefined });
  return next;
}
