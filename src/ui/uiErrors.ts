export const UI_ERROR_EVENT = "firstlight:ui-error";

export function reportUiError(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(UI_ERROR_EVENT, { detail: message }));
}
