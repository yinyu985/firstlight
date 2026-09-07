import { useEffect } from "react";

/** Keep only the topmost dialog and its dismissal backdrop interactive. */
export function useModalIsolation(kind: "diff" | "settings" | "notes" | undefined): void {
  useEffect(() => {
    if (!kind) return;
    const app = document.querySelector(".app");
    if (!app) return;
    const active =
      kind === "diff" ? ".modal-backdrop, .component-error" : kind === "settings" ? ".settings-drawer, .drawer-backdrop" : ".notes-overlay, .component-error";
    const previous = Array.from(app.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .map((node) => ({ node, inert: node.inert }));
    for (const { node } of previous) if (!node.matches(active)) node.inert = true;
    return () => {
      for (const { node, inert } of previous) node.inert = inert;
    };
  }, [kind]);
}
